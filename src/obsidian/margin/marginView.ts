// The comment margin (SPEC §5.2): a layer inside the editor's scroll container,
// cards positioned level with their anchors via CodeMirror's measure cycle.
// If the pane is too narrow for page + margin, the margin hides and a button
// offers the sidebar instead.

import { Facet, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view';
import type { App } from 'obsidian';
import { layoutCards, type CardBox } from '../../core/layout';
import { stripMarkers } from '../../core/markers';
import type { Thread } from '../../core/model';
import { folioField, setActive, setHover, type FolioState } from '../cm/state';
import { cancelDraft, createComment, ops, revealThread } from '../commentOps';
import { createComposer } from '../composer';
import { isMenuOpen } from '../menus';
import { ThreadCard, type CardHost } from './card';

/** What the margin needs from the plugin. */
export interface MarginContext {
	app: App;
	marginWidth(): number;
	/** Comment text size in px (0 = theme default). */
	commentFontSize(): number;
	/** Is this editor the main editor of a markdown leaf (not a popover, canvas or embed)? */
	isMainEditor(view: EditorView): boolean;
	sourcePath(view: EditorView): string;
	isTree(path: string, id: string): boolean;
	setTree(path: string, id: string, tree: boolean): void;
	openSidebar(): void;
	/** Called after the margin re-renders (sidebar sync). */
	changed(view: EditorView): void;
}

export const marginContext = Facet.define<MarginContext, MarginContext | null>({ combine: (v) => v[0] ?? null });

/** Dispatched to make CodeMirror re-read editor attributes after the wide/narrow state flips. */
const relayout = StateEffect.define<null>();

const MIN_TEXT_WIDTH = 380;
const GAP = 10;
const DETACHED = '__folio_detached__';
const DRAFT = '__folio_draft__';

class MarginPlugin implements PluginValue {
	readonly layer: HTMLElement;
	private cards = new Map<string, ThreadCard>();
	private draftEl: HTMLElement | null = null;
	private draftKey = '';
	private detachedEl: HTMLElement;
	private narrowBtn: HTMLElement;
	private resize: ResizeObserver;
	private lastVersion = -1;
	private lastUI: FolioState['ui'] | null = null;
	private lastResolvedSetting: boolean | null = null;
	wide = false;
	/** Whether this editor gets a margin at all (main editor with comments or a draft). */
	active = false;
	private destroyed = false;
	private host: CardHost;

	constructor(private view: EditorView) {
		this.layer = createDiv({ cls: 'folio-margin' });
		this.detachedEl = this.layer.createDiv({ cls: 'folio-detached-header', text: 'Detached comments' });
		this.detachedEl.hide();
		this.narrowBtn = createDiv({ cls: 'folio-narrow-btn', attr: { 'aria-label': 'Open comments in the sidebar' } });
		this.narrowBtn.hide();
		this.narrowBtn.addEventListener('mousedown', (e) => e.preventDefault());
		this.narrowBtn.addEventListener('click', () => this.ctx()?.openSidebar());
		view.scrollDOM.appendChild(this.layer);
		view.dom.appendChild(this.narrowBtn);
		// Keep CodeMirror from treating clicks/keys in cards as editor input.
		for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'paste', 'cut', 'copy', 'contextmenu', 'focusin', 'compositionstart', 'compositionend']) {
			this.layer.addEventListener(type, (e) => e.stopPropagation());
		}
		// Clicking outside the text (the grey surround, page margins, empty space
		// between cards) deactivates the active comment, like clicking in the text does.
		view.scrollDOM.addEventListener('mousedown', this.onOutsideMouseDown);
		this.layer.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea')) this.view.focus();
		});
		this.host = this.makeHost();
		this.resize = new ResizeObserver(() => this.schedule());
		this.resize.observe(view.scrollDOM);
		this.resize.observe(this.layer);
		this.sync(true);
		// The MarkdownView may not know this editor yet while it is being constructed.
		window.requestAnimationFrame(() => {
			if (!this.destroyed) this.sync(true);
		});
	}

	private onOutsideMouseDown = (e: MouseEvent): void => {
		const t = e.target as Node | null;
		if (!t || this.layer.contains(t) || this.view.contentDOM.contains(t)) return;
		const st = this.st();
		if (st?.ui.activeId) this.view.dispatch({ effects: setActive.of(null) });
	};

	private ctx(): MarginContext | null {
		return this.view.state.facet(marginContext);
	}

	private st(): FolioState | null {
		return this.view.state.field(folioField, false) ?? null;
	}

	private makeHost(): CardHost {
		const v = this.view;
		const ctx = () => this.ctx();
		return {
			get app() {
				return ctx()!.app;
			},
			sourcePath: () => ctx()?.sourcePath(v) ?? '',
			reply: (id, parent, body) => ops.reply(v, id, parent, body),
			edit: (id, cid, body) => ops.edit(v, id, cid, body),
			deleteComment: (id, cid) => ops.deleteComment(v, id, cid),
			deleteThread: (id) => ops.deleteThread(v, id),
			resolve: (id, r) => ops.resolve(v, id, r),
			setPriority: (id, p) => ops.setPriority(v, id, p),
			activate: (id) => revealThread(v, id, { select: true }),
			goTo: (id) => revealThread(v, id, { select: true, center: true }),
			hover: (id) => {
				if (this.st()?.ui.hoverId !== id) v.dispatch({ effects: setHover.of(id) });
			},
			isTree: (id) => ctx()?.isTree(ctx()!.sourcePath(v), id) ?? false,
			setTree: (id, tree) => {
				const c = ctx();
				if (!c) return;
				c.setTree(c.sourcePath(v), id, tree);
				this.sync(true);
			},
			changed: () => this.schedule(),
		};
	}

	update(u: ViewUpdate): void {
		const st = this.st();
		const dataChanged = !!st && (st.version !== this.lastVersion || st.ui !== this.lastUI);
		const relayoutAsked = u.transactions.some((t) => t.effects.some((e) => e.is(relayout)));
		if (dataChanged || relayoutAsked) this.sync(false);
		if (dataChanged || relayoutAsked || u.geometryChanged || u.heightChanged || u.viewportChanged) this.schedule();
	}

	/** Create/remove/update cards to match the state. */
	sync(force: boolean): void {
		const st = this.st();
		const ctx = this.ctx();
		if (!st || !ctx) return;
		this.lastVersion = st.version;
		const uiChanged = st.ui !== this.lastUI;
		this.lastUI = st.ui;
		const main = ctx.isMainEditor(this.view);
		const visible = (t: Thread) => !t.resolved || st.ui.showResolved;
		const anchored = st.doc.anchored.filter((id) => visible(st.doc.threads[id]!));
		const detached = st.doc.detached.filter((id) => visible(st.doc.threads[id]!));
		this.active = main && (anchored.length + detached.length > 0 || !!st.ui.draft);
		if (!this.active) {
			for (const c of this.cards.values()) c.destroy();
			this.cards.clear();
			this.removeDraft();
			this.detachedEl.hide();
			this.narrowBtn.hide();
			this.layer.hide();
			this.checkAttrs();
			if (main) ctx.changed(this.view);
			return;
		}
		this.layer.show();
		// Comment text size applies at once (card heights then change, and the ResizeObserver re-lays out).
		const size = ctx.commentFontSize();
		if (size > 0) this.layer.style.setProperty('--folio-comment-size', `${size}px`);
		else this.layer.style.removeProperty('--folio-comment-size');
		if (!this.measured) this.wide = this.computeWide();
		this.layer.toggleClass('is-hidden', !this.wide);
		const md = this.view.state.doc;
		const wanted = new Set([...anchored, ...detached]);
		for (const [id, card] of this.cards) {
			if (!wanted.has(id)) {
				card.destroy();
				this.cards.delete(id);
			}
		}
		for (const id of [...anchored, ...detached]) {
			let card = this.cards.get(id);
			if (!card) {
				card = new ThreadCard(this.host, id, 'margin');
				this.cards.set(id, card);
				this.layer.appendChild(card.el);
				this.resize.observe(card.el);
			}
			const a = st.doc.markers.anchors.get(id);
			const thread = st.doc.threads[id]!;
			card.render(thread, {
				active: st.ui.activeId === id,
				detached: !a,
				showQuote: false,
				quote: a ? stripMarkers(md.sliceString(a.textFrom, a.textTo)) : thread.quote,
			});
		}
		this.detachedEl.toggle(detached.length > 0);
		if (detached.length) this.detachedEl.setText(`Detached comments (${detached.length})`);
		this.syncDraft(st);
		this.narrowBtn.setText(`💬 ${anchored.length + detached.length}`);
		this.narrowBtn.toggle(!this.wide);
		void force;
		void uiChanged;
		this.checkAttrs();
		ctx.changed(this.view);
	}

	private attrsKey = '';
	/** Editor attributes depend on active/wide; make CodeMirror re-read them when they change. */
	private checkAttrs(): void {
		const key = JSON.stringify(this.attrs());
		if (key === this.attrsKey) return;
		this.attrsKey = key;
		window.setTimeout(() => {
			if (!this.destroyed) this.view.dispatch({ effects: relayout.of(null) });
		}, 0);
	}

	private syncDraft(st: FolioState): void {
		const d = st.ui.draft;
		if (d && !this.draftEl) {
			this.wide = this.computeWide();
			this.layer.toggleClass('is-hidden', !this.wide);
		}
		if (!d || !this.wide) {
			this.removeDraft();
			return;
		}
		const key = `${d.from}`;
		if (this.draftEl) {
			this.draftKey = key;
			return;
		}
		this.draftKey = key;
		const el = this.layer.createDiv({ cls: 'folio-card folio-card-margin folio-draft is-active' });
		el.createDiv({ cls: 'folio-card-header' }).createSpan({ cls: 'folio-card-meta', text: 'New comment' });
		const comp = createComposer(el, {
			placeholder: 'Comment…',
			submitLabel: 'Comment',
			autofocus: true,
			app: this.ctx()?.app,
			priority: 'normal',
			onSubmit: (text, { priority }) => {
				createComment(this.view, text, undefined, priority);
			},
			onCancel: () => {
				cancelDraft(this.view);
				this.view.focus();
			},
		});
		// An empty draft disappears when focus leaves it (as in Google Docs).
		comp.textarea.addEventListener('blur', () => {
			window.setTimeout(() => {
				// (not while its priority menu is open)
				if (this.draftEl && !isMenuOpen() && !this.draftEl.contains(activeDocument.activeElement) && comp.textarea.value.trim() === '') cancelDraft(this.view);
			}, 150);
		});
		this.draftEl = el;
		// re-layout while the new comment grows, so it never covers other cards
		this.resize.observe(el);
	}

	private removeDraft(): void {
		this.draftEl?.remove();
		this.draftEl = null;
		this.draftKey = '';
	}

	private schedule(): void {
		if (this.destroyed) return;
		this.view.requestMeasure({ key: this, read: () => this.measure(), write: (m) => this.apply(m) });
	}

	private measure(): Measured | null {
		const st = this.st();
		const ctx = this.ctx();
		if (!st || !ctx || !this.active) return null;
		const scroller = this.view.scrollDOM;
		const sRect = scroller.getBoundingClientRect();
		const width = ctx.marginWidth();
		const wide = this.computeWide();
		const originY = scroller.scrollTop - sRect.top;
		const docTop = this.view.documentTop;
		const yOf = (pos: number): number => {
			const vis = this.view.visibleRanges.some((r) => pos >= r.from && pos <= r.to);
			if (vis) {
				const c = this.view.coordsAtPos(pos, 1);
				if (c) return c.top + originY;
			}
			return docTop + this.view.lineBlockAt(pos).top + originY;
		};
		const boxes: CardBox[] = [];
		let order = 0;
		for (const id of st.doc.anchored) {
			const card = this.cards.get(id);
			const a = st.doc.markers.anchors.get(id);
			if (!card || !a) continue;
			boxes.push({ id, ideal: yOf(a.textFrom), height: card.el.offsetHeight, order: order++ });
		}
		if (this.draftEl && st.ui.draft) boxes.push({ id: DRAFT, ideal: yOf(st.ui.draft.from), height: this.draftEl.offsetHeight, order: order++ });
		const detachedIds = st.doc.detached.filter((id) => this.cards.has(id));
		if (detachedIds.length) {
			const end = this.view.state.doc.length;
			const hiddenFrom = st.hidden ? st.hidden.from : end;
			const bottom = docTop + this.view.lineBlockAt(hiddenFrom).bottom + originY + 2 * GAP;
			boxes.push({ id: DETACHED, ideal: bottom, height: this.detachedEl.offsetHeight, order: order++ });
			for (const id of detachedIds) boxes.push({ id, ideal: bottom, height: this.cards.get(id)!.el.offsetHeight, order: order++ });
		}
		const minTop = docTop + originY;
		const activeId = this.draftEl ? DRAFT : st.ui.activeId;
		const tops = layoutCards(boxes, { gap: GAP, activeId, minTop });
		// horizontal: right of the text column
		const sizer = this.view.contentDOM.closest<HTMLElement>('.cm-sizer') ?? this.view.contentDOM;
		const zRect = sizer.getBoundingClientRect();
		let left = zRect.right - sRect.left + scroller.scrollLeft + 2 * GAP;
		left = Math.min(left, scroller.clientWidth - width - GAP);
		return { tops, left, width, wide };
	}

	private measured = false;

	private apply(m: Measured | null): void {
		if (!m || this.destroyed) return;
		this.measured = true;
		this.layer.toggleClass('is-hidden', !m.wide);
		if (m.wide !== this.wide) {
			this.wide = m.wide;
			this.layer.toggleClass('is-hidden', !this.wide);
			this.narrowBtn.toggle(!this.wide && this.active);
			// re-evaluate editor attributes (margin padding) and the draft card outside the measure cycle
			window.setTimeout(() => {
				if (this.destroyed) return;
				this.view.dispatch({ effects: relayout.of(null) });
				const st = this.st();
				if (st?.ui.draft && !this.wide) this.ctx()?.changed(this.view);
			}, 0);
		}
		this.layer.style.left = `${Math.round(m.left)}px`;
		this.layer.style.width = `${m.width}px`;
		for (const [id, top] of m.tops) {
			const el = id === DRAFT ? this.draftEl : id === DETACHED ? this.detachedEl : this.cards.get(id)?.el;
			// `top`, not a transform: transformed layers render text slightly blurry
			if (el) el.style.top = `${Math.round(top)}px`;
		}
	}

	/** Is there room for page + margin? (reads layout) */
	computeWide(): boolean {
		const width = this.ctx()?.marginWidth() ?? 300;
		const availText = this.view.scrollDOM.clientWidth - width - 3 * GAP;
		// hysteresis so the margin doesn't flap at the threshold
		return this.wide ? availText >= MIN_TEXT_WIDTH - 20 : availText >= MIN_TEXT_WIDTH;
	}

	/** Attributes for the editor element (margin padding). */
	attrs(): Record<string, string> | null {
		if (!this.active || !this.wide) return null;
		return { class: 'folio-has-margin', style: `--folio-margin-width: ${this.ctx()?.marginWidth() ?? 300}px` };
	}

	/** Focus the reply box of a card (keyboard navigation). */
	card(id: string): ThreadCard | undefined {
		return this.cards.get(id);
	}

	destroy(): void {
		this.destroyed = true;
		this.view.scrollDOM.removeEventListener('mousedown', this.onOutsideMouseDown);
		this.resize.disconnect();
		for (const c of this.cards.values()) c.destroy();
		this.cards.clear();
		this.layer.remove();
		this.narrowBtn.remove();
	}
}

interface Measured {
	tops: Map<string, number>;
	left: number;
	width: number;
	wide: boolean;
}

export const marginPlugin = ViewPlugin.fromClass(MarginPlugin);

/** Ask the margin of an editor to re-render (e.g. after a tree toggle elsewhere). */
export function refreshMargin(view: EditorView): void {
	view.dispatch({ effects: relayout.of(null) });
}

export const marginExtensions = [
	marginPlugin,
	EditorView.editorAttributes.of((view) => view.plugin(marginPlugin)?.attrs() ?? null),
];

/** Is the margin showing for this editor (wide enough)? */
export function marginIsWide(view: EditorView): boolean {
	const p = view.plugin(marginPlugin);
	const ctx = view.state.facet(marginContext);
	return !!p && !!ctx && ctx.isMainEditor(view) && p.computeWide();
}
