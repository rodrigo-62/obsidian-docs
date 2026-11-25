// Right-sidebar list of comment threads (SPEC §5.2 narrow-pane fallback).
// Lists the threads of the most recently active note in document order and
// highlights the active one. Works with any pane width.
// It also holds the comment search (DECISIONS F8.3): a filter over comment
// bodies, with matches highlighted and Enter / Shift+Enter to step through them.

import { ItemView, MarkdownView, SearchComponent, setIcon, type WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { stripMarkers } from '../core/markers';
import { findOccurrences, matchingComments } from '../core/search';
import { folioField, setHover } from './cm/state';
import { ops, revealThread } from './commentOps';
import { ThreadCard, type CardHost } from './margin/card';
import { editorViewOf } from './cm';
import type FolioPlugin from './main';

export const SIDEBAR_VIEW = 'folio-comments';
/** Name in the CSS Custom Highlight registry (styled with ::highlight() in margin.css). */
const SEARCH_HIGHLIGHT = 'folio-comment-search';
const CURRENT_HIGHLIGHT = 'folio-comment-search-current';

interface Hit {
	/** thread id, comment id and occurrence number, joined by NUL */
	key: string;
	range: Range;
}

const hitThread = (key: string): string => key.split('\u0000')[0]!;

/** Occurrences of `query` in the rendered comment bodies under `root`, in document order. */
function collectHits(root: ParentNode, query: string): Hit[] {
	const out: Hit[] = [];
	root.querySelectorAll<HTMLElement>('.folio-card .folio-comment-body').forEach((body) => {
		const thread = body.closest<HTMLElement>('.folio-card')?.dataset.folioId;
		const comment = body.closest<HTMLElement>('[data-cid]')?.dataset.cid;
		if (!thread || !comment) return;
		textRanges(body, query).forEach((range, i) => out.push({ key: `${thread}\u0000${comment}\u0000${i}`, range }));
	});
	return out;
}

/** Scroll `scroller` so that `range` is a third of the way down, unless it is already well inside the view. */
function scrollRangeIntoView(scroller: HTMLElement, range: Range, topInset: number): void {
	const r = range.getBoundingClientRect();
	if (!r.width && !r.height) return; // not displayed (e.g. the margin is hidden)
	const s = scroller.getBoundingClientRect();
	const top = s.top + topInset;
	const band = (s.bottom - top) * 0.15; // leave it alone only if it is well inside the view
	if (r.top >= top + band && r.bottom <= s.bottom - band) return;
	scroller.scrollTop += r.top - (top + (s.bottom - top) / 3);
}

/** DOM ranges of each occurrence of `query` in the text of `root` (an occurrence may span several text nodes). */
export function textRanges(root: HTMLElement, query: string): Range[] {
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	const starts: number[] = [];
	let full = '';
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		nodes.push(n as Text);
		starts.push(full.length);
		full += (n as Text).data;
	}
	const at = (pos: number, end: boolean): [Text, number] => {
		// The node holding `pos` (for an end position: the node whose text ends at or after it).
		let i = nodes.length - 1;
		while (i > 0 && (end ? starts[i]! >= pos : starts[i]! > pos)) i--;
		return [nodes[i]!, pos - starts[i]!];
	};
	return findOccurrences(full, query).map(([s, e]) => {
		const r = doc.createRange();
		r.setStart(...at(s, false));
		r.setEnd(...at(e, true));
		return r;
	});
}

// NB: field names avoid ItemView's own (headerEl, titleEl, …): shadowing them breaks Obsidian's view loading.
export class CommentsSidebarView extends ItemView {
	private cards = new Map<string, ThreadCard>();
	private sbListEl!: HTMLElement;
	private sbHeaderEl!: HTMLElement;
	private sbEmptyEl!: HTMLElement;
	private sbDetachedHeader!: HTMLElement;
	private host: CardHost;
	private source: MarkdownView | null = null;
	private sbTopEl!: HTMLElement;
	private sbSearch: SearchComponent | null = null;
	private sbSearchStatus!: HTMLElement;
	private query = '';
	/** Matching threads in display order. */
	private matchOrder: string[] = [];
	/** Matches in the sidebar, in display order (Hit keys), and the current one (Enter / Shift+Enter). */
	private hitKeys: string[] = [];
	private currentHit: string | null = null;
	private scrollPending = false;
	private sbSearchCount: HTMLElement | null = null;
	/** The active thread last scrolled to (the list scrolls when it changes, not on every refresh). */
	private lastActive: string | null = null;
	private highlightFrame = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: FolioPlugin) {
		super(leaf);
		const cm = () => this.cm();
		this.host = {
			app: this.app,
			sourcePath: () => this.source?.file?.path ?? '',
			reply: (id, parent, body) => !!cm() && ops.reply(cm()!, id, parent, body),
			edit: (id, cid, body) => !!cm() && ops.edit(cm()!, id, cid, body),
			deleteComment: (id, cid) => !!cm() && ops.deleteComment(cm()!, id, cid),
			deleteThread: (id) => !!cm() && ops.deleteThread(cm()!, id),
			resolve: (id, r) => !!cm() && ops.resolve(cm()!, id, r),
			setPriority: (id, p) => !!cm() && ops.setPriority(cm()!, id, p),
			activate: (id) => {
				const v = cm();
				if (v) revealThread(v, id, { select: true });
			},
			goTo: (id) => {
				const v = cm();
				if (v) revealThread(v, id, { select: true, center: true, focus: true });
			},
			hover: (id) => {
				const v = cm();
				if (v && v.state.field(folioField, false)?.ui.hoverId !== id) v.dispatch({ effects: setHover.of(id) });
			},
			isTree: (id) => plugin.isTree(this.source?.file?.path ?? '', id),
			setTree: (id, tree) => {
				plugin.setTree(this.source?.file?.path ?? '', id, tree);
				this.refresh();
				plugin.refreshMargins();
			},
			// A comment body finished rendering: its text may need highlighting.
			changed: () => this.scheduleHighlight(),
		};
	}

	getViewType(): string {
		return SIDEBAR_VIEW;
	}
	getDisplayText(): string {
		return 'Comments';
	}
	getIcon(): string {
		return 'messages-square';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('folio-sidebar');
		// Header and search stay at the top while the list scrolls.
		const top = (this.sbTopEl = this.contentEl.createDiv({ cls: 'folio-sidebar-top' }));
		this.sbHeaderEl = top.createDiv({ cls: 'folio-sidebar-header' });
		this.renderSearch(top.createDiv({ cls: 'folio-sidebar-search' }));
		this.sbEmptyEl = this.contentEl.createDiv({ cls: 'folio-sidebar-empty' });
		this.sbListEl = this.contentEl.createDiv({ cls: 'folio-sidebar-list' });
		this.sbDetachedHeader = createDiv({ cls: 'folio-detached-header', text: 'Detached comments' });
		// Follow the active note on our own too (in case the plugin's call races the view's creation).
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) this.setSource(leaf.view);
			}),
		);
		this.setSource(this.plugin.lastMarkdownView());
	}

	async onClose(): Promise<void> {
		for (const c of this.cards.values()) c.destroy();
		this.cards.clear();
		if (this.highlightFrame) window.cancelAnimationFrame(this.highlightFrame);
		this.highlightFrame = 0;
		this.highlightRegistry()?.delete(SEARCH_HIGHLIGHT);
		this.highlightRegistry()?.delete(CURRENT_HIGHLIGHT);
	}

	private renderSearch(row: HTMLElement): void {
		const search = new SearchComponent(row).setPlaceholder('Search comments');
		search.onChange((v) => this.setQuery(v));
		search.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.isComposing) {
				e.preventDefault();
				this.stepMatch(e.shiftKey ? -1 : 1);
			} else if (e.key === 'Escape' && this.query) {
				e.preventDefault();
				e.stopPropagation();
				search.setValue('');
				this.setQuery('');
			}
		});
		this.sbSearch = search;
		this.sbSearchStatus = row.createDiv({ cls: 'folio-sidebar-search-status' });
		this.sbSearchStatus.hide();
	}

	private setQuery(q: string): void {
		if (q === this.query) return;
		this.query = q;
		this.contentEl.toggleClass('is-searching', !!q);
		this.currentHit = null;
		this.refresh();
	}

	/** Focus the comment search, optionally starting with `text` (e.g. the editor selection). */
	focusSearch(text?: string): void {
		const search = this.sbSearch;
		if (!search) return;
		if (text !== undefined && text !== this.query) {
			search.setValue(text);
			this.setQuery(text);
		}
		search.inputEl.focus();
		search.inputEl.select();
	}

	/**
	 * Go to the next (or previous) match (DECISIONS F9.2): its thread becomes active,
	 * the match is marked as the current one and scrolled into view, in the sidebar
	 * and in the margin. Focus stays in the search box.
	 */
	private stepMatch(dir: 1 | -1): void {
		const hits = this.hitKeys;
		const activeId = this.cm()?.state.field(folioField, false)?.ui.activeId ?? null;
		if (!hits.length) {
			// Nothing rendered to point at (e.g. the text only matches Markdown syntax): step through threads.
			const ids = this.matchOrder;
			if (!ids.length) return;
			const i = activeId ? ids.indexOf(activeId) : -1;
			const next = i < 0 ? ids[dir > 0 ? 0 : ids.length - 1]! : ids[(i + dir + ids.length) % ids.length]!;
			this.host.activate(next);
			this.scrollCardIntoView(next);
			return;
		}
		const n = hits.length;
		const i = this.currentHit ? hits.indexOf(this.currentHit) : -1;
		const next = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
		this.currentHit = hits[next]!;
		const thread = hitThread(this.currentHit);
		if (activeId !== thread) this.host.activate(thread);
		this.scrollPending = true;
		this.scheduleHighlight();
	}

	/** Scroll a card into view, clear of the sticky header and search box. */
	private scrollCardIntoView(id: string | null): void {
		const card = id ? this.cards.get(id) : undefined;
		if (!card) return;
		this.contentEl.style.setProperty('scroll-padding-top', `${this.sbTopEl.offsetHeight + 8}px`);
		card.el.scrollIntoView({ block: 'nearest' });
	}

	/** Scroll the current match into view: in the sidebar, and in the margin card if the margin shows it. */
	private scrollToCurrentHit(): void {
		const key = this.currentHit;
		if (!key) return;
		const side = collectHits(this.sbListEl, this.query).find((h) => h.key === key);
		if (side) scrollRangeIntoView(this.contentEl, side.range, this.sbTopEl.offsetHeight);
		const cm = this.cm();
		const margin = cm ? collectHits(cm.dom, this.query).find((h) => h.key === key) : undefined;
		if (cm && margin) scrollRangeIntoView(cm.scrollDOM, margin.range, 0);
	}

	private highlightRegistry(): Map<string, unknown> | null {
		const win = this.contentEl.ownerDocument.defaultView as unknown as { CSS?: { highlights?: Map<string, unknown> } } | null;
		return win?.CSS?.highlights ?? null;
	}

	private scheduleHighlight(): void {
		if (this.highlightFrame) return;
		this.highlightFrame = window.requestAnimationFrame(() => {
			this.highlightFrame = 0;
			this.applyHighlight();
		});
	}

	/**
	 * Find the query in the rendered comment bodies of the sidebar and of the source
	 * editor's margin, and highlight it (CSS Custom Highlight API: no DOM changes).
	 * The current match gets a stronger highlight of its own.
	 */
	private applyHighlight(): void {
		const registry = this.highlightRegistry();
		const win = this.contentEl.ownerDocument.defaultView as unknown as { Highlight?: new (...ranges: Range[]) => { priority: number } } | null;
		if (!this.query) {
			this.hitKeys = [];
			this.currentHit = null;
			registry?.delete(SEARCH_HIGHLIGHT);
			registry?.delete(CURRENT_HIGHLIGHT);
			return;
		}
		const side = collectHits(this.sbListEl, this.query);
		const cmDom = this.cm()?.dom;
		const margin = cmDom ? collectHits(cmDom, this.query) : [];
		this.hitKeys = side.map((h) => h.key);
		if (this.currentHit && !this.hitKeys.includes(this.currentHit)) this.currentHit = null;
		this.updateSearchCount();
		if (registry && win?.Highlight) {
			const all = [...side, ...margin];
			registry.set(SEARCH_HIGHLIGHT, new win.Highlight(...all.map((h) => h.range)));
			const current = new win.Highlight(...all.filter((h) => h.key === this.currentHit).map((h) => h.range));
			current.priority = 1;
			registry.set(CURRENT_HIGHLIGHT, current);
		}
		if (this.scrollPending) {
			this.scrollPending = false;
			// The sidebar is ready now; the margin card may still be moving into place (its position animates).
			window.setTimeout(() => this.scrollToCurrentHit(), 30);
			window.setTimeout(() => this.scrollToCurrentHit(), 260);
		}
	}

	private updateSearchCount(): void {
		const el = this.sbSearchCount;
		if (!el || !this.query) return;
		const threads = this.matchOrder.length;
		const t = `${threads} thread${threads === 1 ? '' : 's'}`;
		const n = this.hitKeys.length;
		const i = this.currentHit ? this.hitKeys.indexOf(this.currentHit) : -1;
		el.setText(!threads ? 'No comments match' : !n ? t : i >= 0 ? `${i + 1} / ${n} in ${t}` : `${n} match${n === 1 ? '' : 'es'} in ${t}`);
	}

	private cm(): EditorView | null {
		return editorViewOf(this.source);
	}

	/** Is this the editor whose comments the sidebar lists? */
	shows(view: EditorView): boolean {
		return this.cm() === view;
	}

	setSource(view: MarkdownView | null): void {
		if (view !== this.source) {
			for (const c of this.cards.values()) c.destroy();
			this.cards.clear();
			this.source = view;
		}
		this.refresh();
	}

	focusReply(id: string): void {
		this.refresh();
		this.cards.get(id)?.focusReply();
	}

	/** Re-render from the source editor's state. */
	refresh(): void {
		if (!this.sbListEl) return;
		try {
			this.render();
		} catch (e) {
			console.error('[folio] comments sidebar', e);
			this.sbEmptyEl.setText(`Docs could not show the comments: ${(e as Error).message}`);
			this.sbEmptyEl.show();
		}
	}

	private render(): void {
		const size = this.plugin.settings.commentFontSize;
		if (size > 0) this.contentEl.style.setProperty('--folio-comment-size', `${size}px`);
		else this.contentEl.style.removeProperty('--folio-comment-size');
		// A missing or closed source: fall back to the most recent note.
		if (!this.source || !this.source.file || !editorViewOf(this.source)) {
			const v = this.plugin.lastMarkdownView();
			if (v && v !== this.source) {
				for (const c of this.cards.values()) c.destroy();
				this.cards.clear();
				this.source = v;
			}
		}
		const cm = this.cm();
		const st = cm?.state.field(folioField, false);
		this.renderHeader();
		if (!cm || !st) {
			this.matchOrder = [];
			this.sbSearchStatus.hide();
			this.sbEmptyEl.setText(this.source ? 'Comments are shown for notes in Live Preview or Source mode.' : 'Open a note to see its comments.');
			this.sbEmptyEl.show();
			this.sbListEl.empty();
			for (const c of this.cards.values()) c.destroy();
			this.cards.clear();
			return;
		}
		if (!st.doc.ok) {
			this.sbEmptyEl.setText(`This note's comment data is damaged: ${st.doc.error ?? ''}`);
			this.sbEmptyEl.show();
			return;
		}
		const showResolved = st.ui.showResolved;
		const vis = (id: string) => !st.doc.threads[id]!.resolved || showResolved;
		let anchored = st.doc.anchored.filter(vis);
		let detached = st.doc.detached.filter(vis);
		const q = this.query;
		if (q) {
			const matches = (id: string) => matchingComments(st.doc.threads[id]!, q).length > 0;
			const resolvedHidden = showResolved ? 0 : [...st.doc.anchored, ...st.doc.detached].filter((id) => st.doc.threads[id]!.resolved && matches(id)).length;
			anchored = anchored.filter(matches);
			detached = detached.filter(matches);
			this.matchOrder = [...anchored, ...detached];
			this.renderSearchStatus(resolvedHidden);
			this.sbEmptyEl.hide();
		} else {
			this.matchOrder = [];
			this.sbSearchStatus.hide();
			this.sbEmptyEl.toggle(anchored.length + detached.length === 0);
			this.sbEmptyEl.setText('No comments in this note. Select text and run "Docs: Add comment".');
		}
		const wanted = new Set([...anchored, ...detached]);
		for (const [id, c] of this.cards) {
			if (!wanted.has(id)) {
				c.destroy();
				this.cards.delete(id);
			}
		}
		// Desired order; DOM nodes are only moved if the order changed (moving a node would blur a focused reply box).
		const order: HTMLElement[] = [];
		const place = (id: string) => {
			let card = this.cards.get(id);
			if (!card) {
				card = new ThreadCard(this.host, id, 'sidebar');
				this.cards.set(id, card);
			}
			const a = st.doc.markers.anchors.get(id);
			const t = st.doc.threads[id]!;
			card.render(t, {
				active: st.ui.activeId === id,
				detached: !a,
				showQuote: true,
				quote: a ? stripMarkers(cm.state.sliceDoc(a.textFrom, a.textTo)) : t.quote,
			});
			order.push(card.el);
		};
		anchored.forEach(place);
		if (detached.length) {
			this.sbDetachedHeader.setText(`Detached comments (${detached.length})`);
			order.push(this.sbDetachedHeader);
			detached.forEach(place);
		}
		const current = Array.from(this.sbListEl.children);
		if (current.length !== order.length || order.some((el, i) => current[i] !== el)) {
			const focused = activeDocument.activeElement;
			this.sbListEl.replaceChildren(...order);
			if (focused?.instanceOf(HTMLElement) && this.sbListEl.contains(focused)) focused.focus();
		}
		if (st.ui.activeId !== this.lastActive) {
			this.lastActive = st.ui.activeId;
			// While stepping through search matches, the match is scrolled to instead.
			if (!this.currentHit || hitThread(this.currentHit) !== st.ui.activeId) this.scrollCardIntoView(st.ui.activeId);
		}
		this.scheduleHighlight();
	}

	private renderSearchStatus(resolvedHidden: number): void {
		const el = this.sbSearchStatus;
		el.empty();
		el.show();
		this.sbSearchCount = el.createSpan({ cls: 'folio-sidebar-search-count' });
		this.updateSearchCount();
		if (resolvedHidden) {
			const more = el.createEl('a', { cls: 'folio-sidebar-search-more', text: `${resolvedHidden} more in resolved threads`, href: '#' });
			more.addEventListener('click', (e) => {
				e.preventDefault();
				void this.plugin.toggleShowResolved();
			});
		}
	}

	private sbTitleEl: HTMLElement | null = null;
	private sbResolvedBtn: HTMLElement | null = null;

	private renderHeader(): void {
		const h = this.sbHeaderEl;
		if (!this.sbTitleEl) {
			this.sbTitleEl = h.createDiv({ cls: 'folio-sidebar-title' });
			const actions = h.createDiv({ cls: 'folio-sidebar-actions' });
			const add = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Add comment on the selection (Ctrl+Alt+M)' } });
			setIcon(add, 'message-square-plus');
			add.addEventListener('click', () => {
				if (this.source) this.plugin.addComment(this.source);
			});
			this.sbResolvedBtn = actions.createEl('button', { cls: 'clickable-icon' });
			this.sbResolvedBtn.addEventListener('click', () => void this.plugin.toggleShowResolved());
		}
		this.sbTitleEl.setText(this.source?.file?.basename ?? 'Comments');
		const on = this.plugin.settings.showResolved;
		const btn = this.sbResolvedBtn!;
		if (btn.dataset.on !== String(on)) {
			btn.dataset.on = String(on);
			btn.empty();
			setIcon(btn, on ? 'eye-off' : 'check-check');
			btn.setAttr('aria-label', on ? 'Hide resolved comments' : 'Show resolved comments');
			btn.toggleClass('is-active', on);
		}
	}
}
