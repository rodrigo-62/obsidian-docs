// Headless tests of the CodeMirror glue (state field + edit filter). No DOM needed.
import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { folioField, folioInternal, setDraft, setShowResolved, threadAt } from '../src/obsidian/cm/state';
import { editFilter } from '../src/obsidian/cm/filters';
import { closeMarker as c, openMarker as o, GUARD } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import { createThread, type Threads } from '../src/core/model';
import { inlineCommentStore as store } from '../src/core/commentStore';

const threads = (...ids: string[]): Threads => Object.fromEntries(ids.map((id) => [id, createThread('q', 'body ' + id, '2026-11-20T10:00:00Z')]));

function mk(text: string, ids: string[] = ['x']): EditorState {
	const doc = `${text}\n\n${serializeThreadBlock(threads(...ids))}\n`;
	return EditorState.create({ doc, extensions: [folioField, editFilter] });
}

const body = (s: EditorState) => {
	const st = s.field(folioField);
	return st.hidden ? s.sliceDoc(0, st.hidden.from) : s.doc.toString();
};

function apply(s: EditorState, spec: TransactionSpec): EditorState {
	return s.update(spec).state;
}

function type(s: EditorState, pos: number, text: string): EditorState {
	return apply(s, { changes: { from: pos, insert: text }, selection: EditorSelection.cursor(pos + text.length), userEvent: 'input.type' });
}

describe('folioField', () => {
	it('parses threads and hides the block', () => {
		const s = mk(`a ${o('x')}b${c('x')} c`);
		const st = s.field(folioField);
		expect(st.doc.anchored).toEqual(['x']);
		expect(st.hidden!.to).toBe(s.doc.length);
		expect(s.sliceDoc(st.hidden!.from, st.hidden!.from + 1)).toBe('\n');
		expect(body(s)).toBe(`a ${o('x')}b${c('x')} c\n`);
	});

	it('does not hide a damaged block', () => {
		const s = EditorState.create({ doc: 'x\n\n<!--folio:threads\n{bad\n-->\n', extensions: [folioField] });
		expect(s.field(folioField).hidden).toBeNull();
		expect(s.field(folioField).doc.ok).toBe(false);
	});

	it('keeps thread identity when the block is unchanged', () => {
		const s = mk(`a ${o('x')}b${c('x')} c`);
		const s2 = type(s, 0, 'z');
		expect(s2.field(folioField).doc.threads).toBe(s.field(folioField).doc.threads);
	});

	it('keeps unchanged thread objects when another thread changes', () => {
		let s = mk(`${o('x')}a${c('x')} ${o('y')}b${c('y')}`, ['x', 'y']);
		// first write refreshes the cached quotes ('q' -> actual text)
		s = apply(s, { changes: store.write(s.doc.toString(), s.field(folioField).doc.threads), annotations: folioInternal.of(true) });
		const before = s.field(folioField).doc.threads;
		const md = s.doc.toString();
		const changes = store.write(md, { ...before, y: { ...before.y!, resolved: true } });
		const s2 = apply(s, { changes, annotations: folioInternal.of(true) });
		const after = s2.field(folioField).doc.threads;
		expect(after.x).toBe(before.x);
		expect(after.y).not.toBe(before.y);
	});

	it('activates the thread under the cursor on selection', () => {
		const s = mk(`a ${o('x')}bbb${c('x')} c`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		const s2 = apply(s, { selection: EditorSelection.cursor(a.textFrom + 1), userEvent: 'select.pointer' });
		expect(s2.field(folioField).ui.activeId).toBe('x');
		const s3 = apply(s2, { selection: EditorSelection.cursor(0), userEvent: 'select' });
		expect(s3.field(folioField).ui.activeId).toBeNull();
	});

	it('picks the innermost thread for nested ranges', () => {
		const s = mk(`${o('out')}x ${o('in')}yy${c('in')} z${c('out')}`, ['out', 'in']);
		const st = s.field(folioField);
		const inn = st.doc.markers.anchors.get('in')!;
		expect(threadAt(st, inn.textFrom + 1)).toBe('in');
		expect(threadAt(st, st.doc.markers.anchors.get('out')!.textFrom + 1)).toBe('out');
	});

	it('does not activate a thread when the cursor is at the edge of its highlight', () => {
		const s = mk(`a ${o('x')}bbb${c('x')} c`);
		const st = s.field(folioField);
		const a = st.doc.markers.anchors.get('x')!;
		expect(threadAt(st, a.textFrom)).toBeNull();
		expect(threadAt(st, a.textTo)).toBeNull();
		expect(threadAt(st, a.textFrom + 1)).toBe('x');
	});

	it('hides resolved threads unless show-resolved is on', () => {
		const t = threads('x');
		t.x!.resolved = true;
		const doc = `a ${o('x')}bbb${c('x')} c\n\n${serializeThreadBlock(t)}\n`;
		const s = EditorState.create({ doc, extensions: [folioField] });
		const pos = s.field(folioField).doc.markers.anchors.get('x')!.textFrom + 1;
		expect(threadAt(s.field(folioField), pos)).toBeNull();
		const s2 = apply(s, { effects: setShowResolved.of(true) });
		expect(threadAt(s2.field(folioField), pos)).toBe('x');
	});

	it('maps the draft through edits', () => {
		let s = mk('hello world');
		s = apply(s, { effects: setDraft.of({ from: 6, to: 11 }) });
		s = type(s, 0, 'XX');
		expect(s.field(folioField).ui.draft).toEqual({ from: 8, to: 13 });
	});
});

describe('edit filter', () => {
	it('text typed at the end of a range goes outside it', () => {
		const s = mk(`a ${o('x')}word${c('x')} c`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		const s2 = type(s, a.textTo, 's');
		expect(body(s2)).toBe(`a ${o('x')}word${c('x')}s c\n`);
		expect(s2.selection.main.head).toBe(a.close.to + 1);
	});

	it('text typed at the start of a range goes outside it', () => {
		const s = mk(`a ${o('x')}word${c('x')} c`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		const s2 = type(s, a.textFrom, 'Q');
		expect(body(s2)).toBe(`a Q${o('x')}word${c('x')} c\n`);
	});

	it('text typed inside a range stays inside', () => {
		const s = mk(`a ${o('x')}word${c('x')} c`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		expect(body(type(s, a.textFrom + 2, '-'))).toBe(`a ${o('x')}wo-rd${c('x')} c\n`);
	});

	it('Backspace right after a hidden start marker deletes the previous character', () => {
		const s = mk(`ab${o('x')}cd${c('x')}`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		// with atomic ranges, CodeMirror's deleteCharBackward deletes the whole marker
		const s2 = apply(s, { changes: { from: a.open.from, to: a.open.to }, userEvent: 'delete.backward' });
		expect(body(s2)).toBe(`a${o('x')}cd${c('x')}\n`);
	});

	it('deleting across one marker keeps the marker', () => {
		const s = mk(`ab${o('x')}cd${c('x')}ef`);
		const s2 = apply(s, { changes: { from: 1, to: s.doc.toString().indexOf('d') }, userEvent: 'delete.selection' });
		expect(body(s2)).toBe(`a${o('x')}d${c('x')}ef\n`);
	});

	it('deleting all the commented text detaches the thread', () => {
		const s = mk(`ab${o('x')}cd${c('x')}ef`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		const s2 = apply(s, { changes: { from: a.textFrom, to: a.textTo }, userEvent: 'delete.selection' });
		expect(body(s2)).toBe('abef\n');
		expect(s2.field(folioField).doc.detached).toEqual(['x']);
	});

	it('replacing a selection that starts outside a range puts the text outside', () => {
		const s = mk(`ab${o('x')}cd${c('x')}ef`);
		const from = 1;
		const to = s.doc.toString().indexOf('d');
		const s2 = apply(s, { changes: { from, to, insert: 'Z' }, userEvent: 'input.type' });
		expect(body(s2)).toBe(`aZ${o('x')}d${c('x')}ef\n`);
	});

	it('Select all + delete keeps the hidden thread block', () => {
		const s = mk(`ab${o('x')}cd${c('x')}ef`);
		const s2 = apply(s, { changes: { from: 0, to: s.doc.length }, userEvent: 'delete.selection' });
		expect(s2.doc.toString().startsWith('\n<!--folio:threads')).toBe(true);
		expect(store.read(s2.doc.toString()).threads.x).toBeDefined();
		expect(s2.field(folioField).doc.detached).toEqual(['x']);
	});

	it('text typed after the hidden block goes before it', () => {
		const s = mk('hello');
		const s2 = type(s, s.doc.length, '!');
		// the blank separator line before the block is visible; text typed at the very end lands there
		expect(body(s2)).toBe('hello\n!');
		expect(s2.doc.toString().trimEnd().endsWith('-->')).toBe(true);
	});

	it('Delete at the end of the visible text does not eat into the block', () => {
		const s = mk('hello');
		const h = s.field(folioField).hidden!;
		const s2 = apply(s, { changes: { from: h.from, to: h.from + 1 }, userEvent: 'delete.forward' });
		expect(s2.doc.toString()).toBe(s.doc.toString());
	});

	it('sanitises pasted markers', () => {
		const s = mk(`ab${o('x')}cd${c('x')}ef`);
		const s2 = apply(s, { changes: { from: 0, insert: `${o('x')}dup${c('x')} ${o('zz')}unknown${c('zz')} ` }, userEvent: 'input.paste' });
		expect(body(s2)).toBe(`dup unknown ab${o('x')}cd${c('x')}ef\n`);
	});

	it('leaves Folio’s own transactions and undo alone', () => {
		const s = mk(`ab${o('x')}cd${c('x')}ef`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		const s2 = apply(s, { changes: { from: a.open.from, to: a.open.to }, annotations: folioInternal.of(true), userEvent: 'delete' });
		expect(body(s2)).toBe(`abcd${c('x')}ef\n`);
		const s3 = apply(s, { changes: { from: a.open.from, to: a.open.to }, userEvent: 'undo' });
		expect(body(s3)).toBe(`abcd${c('x')}ef\n`);
	});

	it('handles a guarded marker at the start of a list item', () => {
		const s = mk(`- ${GUARD}${o('x')}item${c('x')} text`);
		const a = s.field(folioField).doc.markers.anchors.get('x')!;
		// Backspace at the visual start of the item text deletes the space before the guard
		const s2 = apply(s, { changes: { from: a.open.from, to: a.open.to }, userEvent: 'delete.backward' });
		expect(body(s2)).toBe(`-${GUARD}${o('x')}item${c('x')} text\n`);
	});
});
