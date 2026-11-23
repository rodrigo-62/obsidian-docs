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
	/** Matching threads in display order (for Enter / Shift+Enter). */
	private matchOrder: string[] = [];
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

	/** Make the next (or previous) matching thread active and show its text. Focus stays in the search box. */
	private stepMatch(dir: 1 | -1): void {
		const ids = this.matchOrder;
		if (!ids.length) return;
		const activeId = this.cm()?.state.field(folioField, false)?.ui.activeId ?? null;
		const i = activeId ? ids.indexOf(activeId) : -1;
		const next = i < 0 ? ids[dir > 0 ? 0 : ids.length - 1]! : ids[(i + dir + ids.length) % ids.length]!;
		this.host.activate(next);
		this.scrollIntoView(next);
	}

	/** Scroll a card into view, clear of the sticky header and search box. */
	private scrollIntoView(id: string | null): void {
		const card = id ? this.cards.get(id) : undefined;
		if (!card) return;
		this.contentEl.style.setProperty('scroll-padding-top', `${this.sbTopEl.offsetHeight + 8}px`);
		card.el.scrollIntoView({ block: 'nearest' });
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

	/** Highlight the query in the rendered comment bodies (CSS Custom Highlight API: no DOM changes). */
	private applyHighlight(): void {
		const registry = this.highlightRegistry();
		const win = this.contentEl.ownerDocument.defaultView as unknown as { Highlight?: new (...ranges: Range[]) => unknown } | null;
		if (!registry || !win?.Highlight) return;
		if (!this.query) {
			registry.delete(SEARCH_HIGHLIGHT);
			return;
		}
		const ranges: Range[] = [];
		this.sbListEl.querySelectorAll<HTMLElement>('.folio-comment-body').forEach((body) => ranges.push(...textRanges(body, this.query)));
		registry.set(SEARCH_HIGHLIGHT, new win.Highlight(...ranges));
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
			this.renderSearchStatus(this.matchOrder.length, resolvedHidden);
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
		this.scrollIntoView(st.ui.activeId);
		this.scheduleHighlight();
	}

	private renderSearchStatus(count: number, resolvedHidden: number): void {
		const el = this.sbSearchStatus;
		el.empty();
		el.show();
		el.createSpan({ text: count ? `${count} thread${count === 1 ? '' : 's'}` : 'No comments match' });
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
