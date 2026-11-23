// Find in a note (Ctrl+F) searches only the text you can see (DECISIONS F8.2).
//
// Obsidian's find bar gets its matches from `editor.searchCursor(query)`, an
// internal method (not in the API) that scans the whole file, including the
// hidden thread block and the comment markers. Its matches there were counted
// ("1 / 20") but invisible when stepped to. We wrap the method so the cursor
// skips matches in those ranges.
//
// Fail-safe: if the method or the cursor it returns doesn't look as expected,
// the cursor is passed through unchanged; if anything throws, wrapping is
// switched off for the session and search behaves as Obsidian's own. Replace
// stays protected either way by searchReplaceFilter.

import { MarkdownView, type Editor, type EditorPosition, type Plugin } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { Range } from '../core/mdScan';
import { hiddenRanges, touchesHidden } from '../core/search';
import { folioField } from './cm/state';

interface SearchRange {
	from: EditorPosition;
	to: EditorPosition;
}

/** The shape of Obsidian's search cursor (checked at runtime before wrapping). */
export interface SearchCursor {
	getIndexAndCount(): [number, number];
	current(): SearchRange | null;
	findNext(): SearchRange | null;
	findPrevious(): SearchRange | null;
	findAll(): SearchRange[];
	replace(text: string, origin?: string): void;
	replaceAll(text: string, origin?: string): void;
}

const METHODS = ['getIndexAndCount', 'current', 'findNext', 'findPrevious', 'findAll', 'replace', 'replaceAll'] as const;
/** Obsidian stops counting at 9999 matches; so do we. */
const COUNT_CAP = 9999;

let broken = false;

function looksLikeCursor(c: unknown): c is SearchCursor {
	return !!c && typeof c === 'object' && METHODS.every((m) => typeof (c as Record<string, unknown>)[m] === 'function');
}

/** Wrap one search cursor so it skips matches in hidden ranges. Exported for tests. */
export function wrapSearchCursor(editor: Editor, cursor: unknown): unknown {
	if (broken || !looksLikeCursor(cursor)) return cursor;
	const cm = (editor as unknown as { cm?: EditorView }).cm;
	if (!cm?.state || typeof editor.posToOffset !== 'function') return cursor;

	const hidden = (): Range[] => {
		const st = cm.state.field(folioField, false);
		return st ? hiddenRanges(st.doc.markers.markers, st.hidden) : [];
	};
	const off = (p: EditorPosition) => editor.posToOffset(p);
	const visible = (h: Range[], r: SearchRange) => !h.length || !touchesHidden(h, off(r.from), off(r.to));

	let cur: SearchRange | null = null;
	/** Step with Obsidian's cursor until a visible match, or until it comes round to a match already seen. */
	const step = (find: () => SearchRange | null): SearchRange | null => {
		const h = hidden();
		let first: number | null = null;
		for (let i = 0; i < 100_000; i++) {
			const m = find();
			if (!m) return (cur = null);
			if (visible(h, m)) return (cur = m);
			const k = off(m.from);
			if (first === null) first = k;
			else if (k === first) return (cur = null);
		}
		return (cur = null);
	};
	const guard = <T>(mine: () => T, theirs: () => T): T => {
		if (broken) return theirs();
		try {
			return mine();
		} catch (e) {
			broken = true;
			console.error('[folio] find in note: could not skip hidden comment data, using Obsidian’s search as is', e);
			return theirs();
		}
	};
	const visibleAll = (): SearchRange[] => {
		const h = hidden();
		return cursor.findAll().filter((r) => visible(h, r));
	};

	const wrapped: SearchCursor = {
		...cursor,
		current: () => guard(() => cur, () => cursor.current()),
		findNext: () => guard(() => step(() => cursor.findNext()), () => cursor.findNext()),
		findPrevious: () => guard(() => step(() => cursor.findPrevious()), () => cursor.findPrevious()),
		findAll: () => guard(visibleAll, () => cursor.findAll()),
		getIndexAndCount: () =>
			guard(
				(): [number, number] => {
					if (!cur) return [0, 0];
					const h = hidden();
					const curTo = off(cur.to);
					let index = 0;
					let count = 0;
					for (const r of cursor.findAll()) {
						if (count >= COUNT_CAP) break;
						if (!visible(h, r)) continue;
						count++;
						if (off(r.from) <= curTo) index++;
					}
					return [index, count];
				},
				() => cursor.getIndexAndCount(),
			),
		// Obsidian's replace() acts on its own current match, which is ours whenever we have one.
		replace: (text, origin) => guard(() => (cur ? cursor.replace(text, origin) : undefined), () => cursor.replace(text, origin)),
		replaceAll: (text, origin) =>
			guard(
				() => {
					const changes = visibleAll().map((r) => ({ from: r.from, to: r.to, text }));
					if (changes.length) editor.transaction({ changes }, origin);
				},
				() => cursor.replaceAll(text, origin),
			),
	};
	return wrapped;
}

type SearchCursorFn = (this: Editor, ...args: unknown[]) => unknown;

/** Patch the editor class's searchCursor once a Markdown editor exists; undone on unload. */
export function installSearchScope(plugin: Plugin): void {
	let patch: { owner: Record<string, unknown>; original: SearchCursorFn; wrapper: SearchCursorFn } | null = null;
	let active = true;

	const tryPatch = () => {
		if (patch || !active) return;
		const view =
			plugin.app.workspace.getActiveViewOfType(MarkdownView) ??
			plugin.app.workspace
				.getLeavesOfType('markdown')
				.map((l) => l.view)
				.find((v): v is MarkdownView => v instanceof MarkdownView);
		const editor = view?.editor as unknown as Record<string, unknown> | undefined;
		if (!editor) return;
		let owner: Record<string, unknown> | null = editor;
		while (owner && !Object.prototype.hasOwnProperty.call(owner, 'searchCursor')) owner = Object.getPrototypeOf(owner) as Record<string, unknown> | null;
		const original = owner?.searchCursor;
		if (!owner || typeof original !== 'function') return;
		const orig = original as SearchCursorFn;
		const wrapper: SearchCursorFn = function (this: Editor, ...args: unknown[]) {
			const cursor = orig.apply(this, args);
			return active ? wrapSearchCursor(this, cursor) : cursor;
		};
		owner.searchCursor = wrapper;
		patch = { owner, original: orig, wrapper };
	};

	plugin.app.workspace.onLayoutReady(tryPatch);
	plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', tryPatch));
	plugin.register(() => {
		active = false;
		// If another plugin wrapped it after us, leave the chain alone; our wrapper is now a pass-through.
		if (patch && patch.owner.searchCursor === patch.wrapper) patch.owner.searchCursor = patch.original;
		patch = null;
	});
}
