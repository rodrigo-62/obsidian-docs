// Right-sidebar list of comment threads (SPEC §5.2 narrow-pane fallback).
// Lists the threads of the most recently active note in document order and
// highlights the active one. Works with any pane width.

import { ItemView, MarkdownView, setIcon, type WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { stripMarkers } from '../core/markers';
import { folioField, setHover } from './cm/state';
import { ops, revealThread } from './commentOps';
import { ThreadCard, type CardHost } from './margin/card';
import { editorViewOf } from './cm';
import type FolioPlugin from './main';

export const SIDEBAR_VIEW = 'folio-comments';

// NB: field names avoid ItemView's own (headerEl, titleEl, …): shadowing them breaks Obsidian's view loading.
export class CommentsSidebarView extends ItemView {
	private cards = new Map<string, ThreadCard>();
	private sbListEl!: HTMLElement;
	private sbHeaderEl!: HTMLElement;
	private sbEmptyEl!: HTMLElement;
	private sbDetachedHeader!: HTMLElement;
	private host: CardHost;
	private source: MarkdownView | null = null;

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
			changed: () => undefined,
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
		this.sbHeaderEl = this.contentEl.createDiv({ cls: 'folio-sidebar-header' });
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
	}

	private cm(): EditorView | null {
		return editorViewOf(this.source);
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
		const anchored = st.doc.anchored.filter(vis);
		const detached = st.doc.detached.filter(vis);
		this.sbEmptyEl.toggle(anchored.length + detached.length === 0);
		this.sbEmptyEl.setText('No comments in this note. Select text and press Ctrl+Alt+M to add one.');
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
			const focused = document.activeElement;
			this.sbListEl.replaceChildren(...order);
			if (focused instanceof HTMLElement && this.sbListEl.contains(focused)) focused.focus();
		}
		const active = st.ui.activeId ? this.cards.get(st.ui.activeId) : undefined;
		if (active) active.el.scrollIntoView({ block: 'nearest' });
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
