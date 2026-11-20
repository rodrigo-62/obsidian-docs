// CodeMirror 6 state for comments: parsed markers + threads, UI state
// (active/hover/draft/show-resolved) and the decorations derived from them.
//
// The whole note is re-parsed on every document change. That costs about 1 ms
// for a 190k-character note with 100 threads (measured), so no incremental
// mapping is needed. Thread objects are reused while the JSON block text is
// unchanged, so the margin can skip re-rendering cards.

import { Annotation, EditorState, RangeSet, StateEffect, StateField, type Range as CMRange, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { inlineCommentStore, type DocComments } from '../../core/commentStore';

/** Marks transactions made by Folio itself (skipped by the edit filters). */
export const folioInternal = Annotation.define<boolean>();

export interface Draft {
	from: number;
	to: number;
}

export interface CommentUI {
	activeId: string | null;
	hoverId: string | null;
	draft: Draft | null;
	showResolved: boolean;
	/** Bumped to request a "flash" of a thread's highlight. */
	flash: { id: string; n: number } | null;
}

export interface FolioState {
	doc: DocComments;
	ui: CommentUI;
	/** Hidden thread block [from, to), or null (no block, or damaged block that must stay visible). */
	hidden: { from: number; to: number } | null;
	decorations: DecorationSet;
	/** Ranges the cursor skips: markers and the hidden block. */
	atomic: RangeSet<Decoration>;
	/** Monotonic counter, bumped whenever doc data changes (for cheap change detection). */
	version: number;
}

export const setActive = StateEffect.define<string | null>();
export const setHover = StateEffect.define<string | null>();
export const setDraft = StateEffect.define<Draft | null>();
export const setShowResolved = StateEffect.define<boolean>();
export const flashThread = StateEffect.define<string | null>();

/** Initial show-resolved value for new editors (set by the plugin from its settings). */
export const defaults = { showResolved: false };

function readDoc(text: Text, prev: DocComments | null): DocComments {
	const doc = inlineCommentStore.read(text.toString());
	if (!prev || !prev.ok || !doc.ok) return doc;
	// Keep thread identity while the JSON block is byte-identical…
	if (prev.block && doc.block && prev.block.json === doc.block.json) {
		doc.threads = prev.threads;
		return doc;
	}
	// …and per thread when only other threads changed, so cards don't re-render needlessly.
	const merged: typeof doc.threads = {};
	for (const [id, t] of Object.entries(doc.threads)) {
		const old = prev.threads[id];
		merged[id] = old && JSON.stringify(old) === JSON.stringify(t) ? old : t;
	}
	doc.threads = merged;
	return doc;
}

function hiddenRange(doc: DocComments, length: number): { from: number; to: number } | null {
	const b = doc.block;
	if (!b || !doc.ok) return null;
	// Hide "\n<!--folio:threads…-->" plus anything after it (whitespace only, normally).
	const from = b.from > 0 ? b.from - 1 : 0;
	const to = b.trailing ? b.to : length;
	return { from, to };
}

class HiddenBlockWidget extends WidgetType {
	constructor(readonly count: number) {
		super();
	}
	eq(other: HiddenBlockWidget): boolean {
		return other.count === this.count;
	}
	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = 'folio-hidden-block';
		el.setAttribute('aria-hidden', 'true');
		return el;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

const markerDeco = Decoration.replace({});

function build(doc: DocComments, ui: CommentUI, hidden: { from: number; to: number } | null): { decorations: DecorationSet; atomic: RangeSet<Decoration> } {
	const ranges: CMRange<Decoration>[] = [];
	const atomic: CMRange<Decoration>[] = [];
	for (const mk of doc.markers.markers) {
		ranges.push(markerDeco.range(mk.from, mk.to));
		atomic.push(markerDeco.range(mk.from, mk.to));
	}
	for (const a of doc.markers.anchors.values()) {
		const t = doc.threads[a.id];
		if (!t || a.textTo <= a.textFrom) continue;
		if (t.resolved && !ui.showResolved) continue;
		const cls = ['folio-hl'];
		if (t.resolved) cls.push('folio-hl-resolved');
		if (ui.activeId === a.id) cls.push('folio-hl-active');
		if (ui.hoverId === a.id) cls.push('folio-hl-hover');
		if (ui.flash?.id === a.id) cls.push(ui.flash.n % 2 ? 'folio-hl-flash' : 'folio-hl-flash2');
		ranges.push(
			Decoration.mark({
				class: cls.join(' '),
				attributes: { 'data-folio-id': a.id },
				inclusiveStart: false,
				inclusiveEnd: false,
			}).range(a.textFrom, a.textTo),
		);
	}
	if (ui.draft && ui.draft.to > ui.draft.from) {
		ranges.push(Decoration.mark({ class: 'folio-hl folio-hl-draft' }).range(ui.draft.from, ui.draft.to));
	}
	if (hidden && hidden.to > hidden.from) {
		const d = Decoration.replace({ widget: new HiddenBlockWidget(Object.keys(doc.threads).length) });
		ranges.push(d.range(hidden.from, hidden.to));
		atomic.push(d.range(hidden.from, hidden.to));
	}
	return { decorations: Decoration.set(ranges, true), atomic: RangeSet.of(atomic, true) };
}

function create(state: EditorState): FolioState {
	const doc = readDoc(state.doc, null);
	const ui: CommentUI = { activeId: null, hoverId: null, draft: null, showResolved: defaults.showResolved, flash: null };
	const hidden = hiddenRange(doc, state.doc.length);
	return { doc, ui, hidden, version: 0, ...build(doc, ui, hidden) };
}

export const folioField = StateField.define<FolioState>({
	create,
	update(value, tr) {
		let ui = value.ui;
		let doc = value.doc;
		let version = value.version;
		let changed = false;
		if (tr.docChanged) {
			doc = readDoc(tr.newDoc, value.doc);
			version++;
			changed = true;
			if (ui.draft) {
				const from = tr.changes.mapPos(ui.draft.from, 1);
				const to = tr.changes.mapPos(ui.draft.to, -1);
				ui = { ...ui, draft: to > from ? { from, to } : null };
			}
		}
		for (const e of tr.effects) {
			if (e.is(setActive) && ui.activeId !== e.value) ui = { ...ui, activeId: e.value };
			else if (e.is(setHover) && ui.hoverId !== e.value) ui = { ...ui, hoverId: e.value };
			else if (e.is(setDraft)) ui = { ...ui, draft: e.value };
			else if (e.is(setShowResolved) && ui.showResolved !== e.value) ui = { ...ui, showResolved: e.value };
			else if (e.is(flashThread)) ui = { ...ui, flash: e.value ? { id: e.value, n: (ui.flash?.n ?? 0) + 1 } : null };
		}
		// A cursor (empty selection) inside commented text activates that thread, however it
		// got there: click, arrows, typing. A non-empty selection doesn't change the active
		// thread (as in Google Docs). An explicit setActive in the transaction wins.
		if (tr.selection && tr.selection.main.empty && !tr.effects.some((e) => e.is(setActive))) {
			const probe = { ...value, doc, ui } as FolioState;
			const id = threadAt(probe, tr.selection.main.head);
			if (id !== ui.activeId && (id !== null || !ui.draft)) ui = { ...ui, activeId: id };
		}
		// Forget UI references to threads that no longer exist.
		if (ui.activeId && !doc.threads[ui.activeId]) ui = { ...ui, activeId: null };
		if (ui.hoverId && !doc.threads[ui.hoverId]) ui = { ...ui, hoverId: null };
		if (!changed && ui === value.ui) return value;
		const hidden = changed ? hiddenRange(doc, tr.newDoc.length) : value.hidden;
		return { doc, ui, hidden, version, ...build(doc, ui, hidden) };
	},
	provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
});

export function folioState(state: EditorState): FolioState | null {
	return state.field(folioField, false) ?? null;
}

/**
 * The innermost visible thread whose highlighted text contains `pos` strictly
 * inside it: a cursor sitting at the edge of a highlight doesn't activate it.
 */
export function threadAt(st: FolioState, pos: number): string | null {
	let best: string | null = null;
	let bestLen = Infinity;
	for (const a of st.doc.markers.anchors.values()) {
		const t = st.doc.threads[a.id];
		if (!t || (t.resolved && !st.ui.showResolved)) continue;
		if (a.textFrom < pos && pos < a.textTo && a.textTo - a.textFrom < bestLen) {
			best = a.id;
			bestLen = a.textTo - a.textFrom;
		}
	}
	return best;
}
