// Edit rules for comment markers (SPEC §5.4), applied to user transactions:
// - text typed at the edge of a commented range goes outside it;
// - a marker is only deleted together with its partner; Backspace/Delete
//   step over hidden markers; a range left empty is removed (thread detached);
// - pasted markers are sanitised;
// - the hidden thread block can't be edited and stays last.
// Copy/cut strip markers from the clipboard text.

import { ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { adjustDeletions, adjustInsertionPos, sanitizePastedMarkers, stripMarkers } from '../../core/markers';
import type { Range } from '../../core/mdScan';
import { folioField, folioInternal } from './state';

interface RawChange {
	from: number;
	to: number;
	insert: string;
}

export const editFilter = EditorState.transactionFilter.of((tr): Transaction | readonly TransactionSpec[] => {
	if (!tr.docChanged || tr.annotation(folioInternal)) return tr;
	if (tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
	const userEvent = tr.annotation(Transaction.userEvent);
	if (!userEvent || !/^(input|delete|move)/.test(userEvent)) return tr;
	const st = tr.startState.field(folioField, false);
	if (!st) return tr;
	const parse = st.doc.markers;
	if (!parse.markers.length && !st.hidden && !tr.isUserEvent('input.paste') && !tr.isUserEvent('input.drop')) return tr;

	const composing = tr.isUserEvent('input.type.compose');
	const isPaste = tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop') || tr.isUserEvent('move.drop');
	const direction = tr.isUserEvent('delete.backward') ? 'backward' : tr.isUserEvent('delete.forward') ? 'forward' : null;
	const hidden = st.hidden;

	const original: RawChange[] = [];
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		original.push({ from: fromA, to: toA, insert: inserted.toString() });
	});

	let modified = false;
	const changes: RawChange[] = original.map((c) => {
		let { from, to, insert } = c;
		if (isPaste && insert.includes('<!--')) {
			const threadIds = new Set(Object.keys(st.doc.threads));
			const anchored = new Set(parse.anchors.keys());
			const clean = sanitizePastedMarkers(insert, threadIds, anchored);
			if (clean !== insert) {
				insert = clean;
				modified = true;
			}
		}
		if (hidden) {
			// Nothing may change inside the hidden thread block, and nothing goes after it.
			if (to > hidden.from && from < hidden.to) {
				const nf = Math.min(from, hidden.from);
				const nt = Math.min(to, hidden.from);
				if (nf !== from || nt !== to) {
					from = nf;
					to = nt;
					modified = true;
				}
			} else if (from >= hidden.to && hidden.to === tr.startState.doc.length && from === to) {
				from = to = hidden.from;
				modified = true;
			}
		}
		return { from, to, insert };
	});

	// Deletions: keep marker pairs consistent.
	const deletions: Range[] = changes.filter((c) => c.to > c.from).map((c) => ({ from: c.from, to: c.to }));
	let adjusted: Range[] = deletions;
	if (deletions.length && parse.markers.length) {
		const md = tr.startState.doc.toString();
		const res = adjustDeletions(md, deletions, parse, direction);
		adjusted = res.ranges;
		if (JSON.stringify(adjusted) !== JSON.stringify(deletions)) modified = true;
	}

	// Insertions: at a range edge, typed text goes outside the range.
	const specs: RawChange[] = adjusted.map((d) => ({ from: d.from, to: d.to, insert: '' }));
	let cursorAfter: number | null = null;
	for (const c of changes) {
		if (!c.insert) continue;
		let at: number;
		if (c.to > c.from) {
			// Replacement: put the text where the first remaining piece of the deletion starts.
			const piece = adjusted.find((d) => d.from >= c.from && d.from < c.to) ?? adjusted.find((d) => d.to > c.from && d.from < c.to);
			at = piece ? piece.from : composing ? c.from : adjustInsertionPos(c.from, parse);
		} else {
			at = composing ? c.from : adjustInsertionPos(c.from, parse);
		}
		if (at !== c.from) modified = true;
		const target = specs.find((s) => s.from === at && s.insert === '');
		if (target) target.insert = c.insert;
		else specs.push({ from: at, to: at, insert: c.insert });
		cursorAfter = at;
	}
	if (!modified) return tr;

	specs.sort((a, b) => a.from - b.from || a.to - b.to);
	// Drop overlaps defensively (should not happen).
	const clean: RawChange[] = [];
	for (const s of specs) {
		const last = clean[clean.length - 1];
		if (last && s.from < last.to) continue;
		clean.push(s);
	}
	const changeSpec: ChangeSpec[] = clean.map((s) => ({ from: s.from, to: s.to, insert: s.insert }));
	const cs = ChangeSet.of(changeSpec, tr.startState.doc.length);
	let selection: EditorSelection;
	if (tr.startState.selection.ranges.length === 1 && original.length === 1) {
		if (cursorAfter !== null) selection = EditorSelection.single(cs.mapPos(cursorAfter, 1));
		else if (clean.length) selection = EditorSelection.single(cs.mapPos(clean[0]!.from, -1));
		else selection = tr.startState.selection.map(cs);
	} else {
		selection = tr.startState.selection.map(cs, 1);
	}
	return [
		{
			changes: changeSpec,
			selection,
			effects: tr.effects,
			scrollIntoView: tr.scrollIntoView,
			userEvent,
		},
	];
});

/** Copy/cut without markers or the thread block. */
function clipboardHandler(cut: boolean) {
	return (event: ClipboardEvent, view: EditorView): boolean => {
		const st = view.state.field(folioField, false);
		if (!st || !event.clipboardData) return false;
		const ranges = view.state.selection.ranges.filter((r) => !r.empty);
		if (!ranges.length) return false;
		const touchesMarker = ranges.some(
			(r) => st.doc.markers.markers.some((m) => m.from < r.to && m.to > r.from) || (st.hidden && st.hidden.from < r.to && st.hidden.to > r.from),
		);
		if (!touchesMarker) return false;
		const text = ranges
			.map((r) => {
				const to = st.hidden ? Math.min(r.to, st.hidden.from) : r.to;
				return stripMarkers(view.state.sliceDoc(r.from, Math.max(r.from, to)));
			})
			.join(view.state.lineBreak);
		event.clipboardData.setData('text/plain', text);
		event.preventDefault();
		if (cut) {
			view.dispatch({
				changes: ranges.map((r) => ({ from: r.from, to: r.to })),
				userEvent: 'delete.cut',
				scrollIntoView: true,
			});
		}
		return true;
	};
}

export const clipboardHandlers = EditorView.domEventHandlers({
	copy: clipboardHandler(false),
	cut: clipboardHandler(true),
});
