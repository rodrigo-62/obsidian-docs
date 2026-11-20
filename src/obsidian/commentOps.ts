// Comment write operations. With an open editor they are editor transactions
// (undoable, no stale content); otherwise they go through app.vault.process.

import { Notice, type App, type TFile } from 'obsidian';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { inlineCommentStore as store } from '../core/commentStore';
import { planAnchorInsertion } from '../core/markers';
import { addReply, deleteComment, editComment, nowIso, setResolved, type Thread, type Threads } from '../core/model';
import { applyChanges, type Change } from '../core/threadStore';
import { flashThread, folioField, folioInternal, setActive, setDraft, type Draft } from './cm/state';

export type ThreadUpdate = (t: Thread) => Thread | null;

function dispatch(view: EditorView, changes: Change[], extra: { effects?: import('@codemirror/state').StateEffect<unknown>[]; selection?: { anchor: number; head?: number } } = {}): void {
	view.dispatch({
		changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })),
		annotations: [folioInternal.of(true), Transaction.userEvent.of('folio.comment')],
		effects: extra.effects,
		selection: extra.selection,
	});
}

function damaged(error?: string): void {
	new Notice(`Folio: this note's comment data is damaged and was not changed. ${error ?? ''}`.trim(), 8000);
}

/** Check a selection can be commented on (without changing anything). */
export function validateSelection(view: EditorView, from: number, to: number): string | null {
	const st = view.state.field(folioField, false);
	if (!st) return 'Comments are not available in this editor.';
	if (!st.doc.ok) return "This note's comment data is damaged; fix the folio:threads block first.";
	const plan = planAnchorInsertion(view.state.doc.toString(), from, to, 'probe', st.doc.markers);
	return plan.ok ? null : plan.error;
}

/** Start a comment on the current selection: shows the draft highlight. Returns the draft or null (with a notice). */
export function startDraft(view: EditorView): Draft | null {
	const sel = view.state.selection.main;
	let { from, to } = sel;
	if (from === to) {
		// No selection: use the word at the cursor, as Google Docs does.
		const word = view.state.wordAt(from);
		if (word) ({ from, to } = word);
	}
	const err = validateSelection(view, from, to);
	if (err) {
		new Notice(`Folio: ${err}`);
		return null;
	}
	const draft = { from, to };
	view.dispatch({ effects: setDraft.of(draft) });
	return draft;
}

export function cancelDraft(view: EditorView): void {
	if (view.state.field(folioField, false)?.ui.draft) view.dispatch({ effects: setDraft.of(null) });
}

/** Create a thread from the current draft (or the given range). Returns the new id. */
export function createComment(view: EditorView, body: string, range?: Draft): string | null {
	const st = view.state.field(folioField, false);
	const r = range ?? st?.ui.draft;
	if (!st || !r) return null;
	if (!body.trim()) {
		cancelDraft(view);
		return null;
	}
	const md = view.state.doc.toString();
	const res = store.create(md, r.from, r.to, body.trim(), st.doc, nowIso());
	if (!res.ok) {
		new Notice(`Folio: ${res.error}`);
		return null;
	}
	dispatch(view, res.changes, { effects: [setDraft.of(null), setActive.of(res.id)] });
	return res.id;
}

/** Apply `fn` to one thread (null = delete the thread and its markers). */
export function updateThread(view: EditorView, id: string, fn: ThreadUpdate): boolean {
	const st = view.state.field(folioField, false);
	if (!st) return false;
	if (!st.doc.ok) {
		damaged(st.doc.error);
		return false;
	}
	const t = st.doc.threads[id];
	if (!t) return false;
	const next = fn(t);
	const md = view.state.doc.toString();
	if (next === null) {
		dispatch(view, store.remove(md, id, st.doc));
		return true;
	}
	const threads: Threads = { ...st.doc.threads, [id]: next };
	dispatch(view, store.write(md, threads, st.doc));
	return true;
}

export const ops = {
	reply: (view: EditorView, id: string, parentId: string | null, body: string) => updateThread(view, id, (t) => addReply(t, parentId, body.trim())),
	edit: (view: EditorView, id: string, commentId: string, body: string) => updateThread(view, id, (t) => editComment(t, commentId, body.trim())),
	deleteComment: (view: EditorView, id: string, commentId: string) => updateThread(view, id, (t) => deleteComment(t, commentId)),
	deleteThread: (view: EditorView, id: string) => updateThread(view, id, () => null),
	resolve: (view: EditorView, id: string, resolved: boolean) => updateThread(view, id, (t) => setResolved(t, resolved)),
};

/** Same operations for a note that is not open in an editor. */
export async function updateThreadInFile(app: App, file: TFile, id: string, fn: ThreadUpdate): Promise<boolean> {
	let ok = false;
	await app.vault.process(file, (md) => {
		const doc = store.read(md);
		if (!doc.ok) {
			damaged(doc.error);
			return md;
		}
		const t = doc.threads[id];
		if (!t) return md;
		const next = fn(t);
		ok = true;
		if (next === null) return applyChanges(md, store.remove(md, id, doc));
		return applyChanges(md, store.write(md, { ...doc.threads, [id]: next }, doc));
	});
	return ok;
}

/** Remove stray/empty markers (command "Repair comment markers"). */
export function repairMarkers(view: EditorView): number {
	const st = view.state.field(folioField, false);
	if (!st) return 0;
	if (!st.doc.ok) {
		damaged(st.doc.error);
		return 0;
	}
	const changes = store.repair(view.state.doc.toString(), st.doc);
	if (changes.length) dispatch(view, changes);
	return changes.length;
}

/** Select a thread's text, scroll to it and mark it active. */
export function revealThread(view: EditorView, id: string, opts: { select?: boolean; focus?: boolean } = {}): void {
	const st = view.state.field(folioField, false);
	const a = st?.doc.markers.anchors.get(id);
	if (!a) {
		view.dispatch({ effects: setActive.of(id) });
		return;
	}
	view.dispatch({
		selection: opts.select === false ? undefined : { anchor: a.textFrom, head: a.textTo },
		effects: [setActive.of(id), EditorView.scrollIntoView(a.textFrom, { y: 'center' })],
		annotations: Transaction.userEvent.of('select.folio'),
	});
	if (opts.focus) view.focus();
}

export function flash(view: EditorView, id: string): void {
	view.dispatch({ effects: flashThread.of(id) });
	window.setTimeout(() => view.dispatch({ effects: flashThread.of(null) }), 900);
}
