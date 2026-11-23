// Find & replace in a note skips comment data (DECISIONS F8.1, F8.2).
// The fake cursor follows Obsidian 1.15's editor.searchCursor (case-insensitive,
// overlapping matches, wraps around), so the wrapper is tested against the same behaviour.
import { describe, expect, it } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { folioField } from '../src/obsidian/cm/state';
import { editFilter, searchReplaceFilter } from '../src/obsidian/cm/filters';
import { wrapSearchCursor, type SearchCursor } from '../src/obsidian/searchScope';
import { closeMarker as c, openMarker as o } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import { createThread } from '../src/core/model';
import { inlineCommentStore as store } from '../src/core/commentStore';

interface Pos {
	line: number;
	ch: number;
}

function fakeEditor(doc: string) {
	let state = EditorState.create({ doc, extensions: [folioField, editFilter, searchReplaceFilter] });
	const posToOffset = (p: Pos) => state.doc.line(p.line + 1).from + p.ch;
	const toPos = (off: number): Pos => {
		const l = state.doc.lineAt(off);
		return { line: l.number - 1, ch: off - l.from };
	};
	const dispatch = (spec: TransactionSpec) => {
		state = state.update(spec).state;
	};
	const editor = {
		cm: {
			get state() {
				return state;
			},
		},
		posToOffset,
		replaceRange: (text: string, from: Pos, to: Pos, origin?: string) => dispatch({ changes: { from: posToOffset(from), to: posToOffset(to), insert: text }, userEvent: origin }),
		transaction: (tx: { changes: { from: Pos; to: Pos; text: string }[] }, origin?: string) =>
			dispatch({ changes: tx.changes.map((ch) => ({ from: posToOffset(ch.from), to: posToOffset(ch.to), insert: ch.text })), userEvent: origin }),
		text: () => state.doc.toString(),
	};

	/** Obsidian's cursor, as in app.js (1.15.1). */
	function searchCursor(query: string): SearchCursor {
		const q = query.toLowerCase();
		const starts = (from = 0, to = state.doc.length) => {
			const t = state.doc.toString().toLowerCase();
			const out: number[] = [];
			for (let i = t.indexOf(q, from); i >= 0 && i + q.length <= to; i = t.indexOf(q, i + 1)) out.push(i);
			return out;
		};
		let n = state.selection.main.from;
		let a = state.selection.main.to;
		let cur: { from: Pos; to: Pos } | null = null;
		const set = (s: number) => {
			n = s;
			a = s + q.length;
			return (cur = { from: toPos(s), to: toPos(s + q.length) });
		};
		const self: SearchCursor = {
			getIndexAndCount() {
				if (!cur) return [0, 0];
				const u = posToOffset(cur.to);
				const all = starts();
				return [all.filter((s) => s <= u).length, all.length];
			},
			current: () => cur,
			findNext() {
				const s = starts(a)[0] ?? starts()[0];
				return s === undefined ? (cur = null) : set(s);
			},
			findPrevious() {
				cur = null;
				const s = starts(0, n).pop() ?? starts(n).pop();
				return s === undefined ? null : set(s);
			},
			findAll: () => starts().map((s) => ({ from: toPos(s), to: toPos(s + q.length) })),
			replace(text, origin) {
				const u = self.current();
				if (u) editor.replaceRange(text, u.from, u.to, origin);
			},
			replaceAll(text, origin) {
				editor.transaction({ changes: self.findAll().map((f) => ({ from: f.from, to: f.to, text })) }, origin);
			},
		};
		return self;
	}
	const wrapped = (query: string) => wrapSearchCursor(editor as never, searchCursor(query)) as SearchCursor;
	return { editor, searchCursor, wrapped, offset: posToOffset };
}

const thread = createThread('light', 'More light here; resolved is true', '2026-11-20T10:00:00Z');
const DOC = `Light at ${o('x')}the light${c('x')} house\n\n${serializeThreadBlock({ x: thread })}\n`;

describe('searchReplaceFilter', () => {
	it('drops replacements inside the thread block and the markers, keeps the rest', () => {
		const { searchCursor, editor } = fakeEditor(DOC);
		searchCursor('light').replaceAll('lamp', 'searchReplace');
		const out = editor.text();
		expect(out.startsWith(`lamp at ${o('x')}the lamp${c('x')} house`)).toBe(true);
		const doc = store.read(out);
		expect(doc.ok).toBe(true);
		expect(doc.threads.x!.comments[0]!.body).toBe('More light here; resolved is true');
	});
	it('protects the JSON from replacing keys and values', () => {
		const { searchCursor, editor } = fakeEditor(DOC);
		searchCursor('false').replaceAll('true', 'searchReplace');
		searchCursor('"').replaceAll('', 'searchReplace');
		searchCursor('c:x').replaceAll('', 'searchReplace');
		expect(editor.text()).toBe(DOC);
	});
});

describe('wrapSearchCursor', () => {
	it('counts and visits only visible matches', () => {
		const { wrapped, searchCursor, offset } = fakeEditor(DOC);
		expect(searchCursor('light').findAll().length).toBeGreaterThan(2); // the quote and body count too, unwrapped
		const cur = wrapped('light');
		const a = cur.findNext()!;
		expect(offset(a.from)).toBe(0);
		expect(cur.getIndexAndCount()).toEqual([1, 2]);
		const b = cur.findNext()!;
		expect(offset(b.from)).toBe(DOC.indexOf('light', 1));
		expect(cur.getIndexAndCount()).toEqual([2, 2]);
		const again = cur.findNext()!; // wraps past the block to the first match
		expect(offset(again.from)).toBe(0);
		expect(cur.findAll().length).toBe(2);
	});
	it('steps backwards, wrapping to the last visible match', () => {
		const { wrapped, offset } = fakeEditor(DOC);
		const cur = wrapped('light');
		expect(offset(cur.findPrevious()!.from)).toBe(DOC.indexOf('light', 1));
		expect(offset(cur.findPrevious()!.from)).toBe(0);
	});
	it('finds nothing for text that only exists in comment data', () => {
		const { wrapped } = fakeEditor(DOC);
		for (const q of ['resolved', 'c:x', '"comments"']) {
			const cur = wrapped(q);
			expect(cur.findNext()).toBeNull();
			expect(cur.findPrevious()).toBeNull();
			expect(cur.current()).toBeNull();
			expect(cur.getIndexAndCount()).toEqual([0, 0]);
			expect(cur.findAll()).toEqual([]);
		}
	});
	it('replaces only visible matches', () => {
		const { wrapped, editor } = fakeEditor(DOC);
		const cur = wrapped('light');
		cur.findNext();
		cur.replace('Lamp', 'searchReplace');
		expect(editor.text().startsWith(`Lamp at ${o('x')}the light${c('x')}`)).toBe(true);
		wrapped('light').replaceAll('lamp', 'searchReplace');
		expect(editor.text().startsWith(`Lamp at ${o('x')}the lamp${c('x')}`)).toBe(true);
		expect(store.read(editor.text()).threads.x!.comments[0]!.body).toContain('More light');
	});
	it('passes through anything that is not a search cursor', () => {
		const { editor } = fakeEditor(DOC);
		const odd = { findNext: () => null };
		expect(wrapSearchCursor(editor as never, odd)).toBe(odd);
		expect(wrapSearchCursor(editor as never, null)).toBe(null);
		const plain = fakeEditor(DOC).searchCursor('x');
		expect(wrapSearchCursor({} as never, plain)).toBe(plain); // no CodeMirror view behind the editor
	});
	it('falls back to Obsidian’s cursor if wrapping fails (runs last: it switches wrapping off)', () => {
		const { editor, searchCursor } = fakeEditor(DOC);
		const bad = { ...editor, posToOffset: () => { throw new Error('boom'); } };
		const original = searchCursor('light');
		const cur = wrapSearchCursor(bad as never, original) as SearchCursor;
		const quiet = console.error;
		console.error = () => undefined;
		try {
			expect(cur.findNext()).not.toBeNull(); // Obsidian's result, unfiltered
		} finally {
			console.error = quiet;
		}
		expect(wrapSearchCursor(editor as never, original)).toBe(original); // off for the session
	});
});
