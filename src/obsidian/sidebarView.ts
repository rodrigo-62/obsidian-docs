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

export class CommentsSidebarView extends ItemView {
	private cards = new Map<string, ThreadCard>();
	private listEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private emptyEl!: HTMLElement;
	private detachedHeader!: HTMLElement;
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
		this.headerEl = this.contentEl.createDiv({ cls: 'folio-sidebar-header' });
		this.emptyEl = this.contentEl.createDiv({ cls: 'folio-sidebar-empty' });
		this.listEl = this.contentEl.createDiv({ cls: 'folio-sidebar-list' });
		this.detachedHeader = createDiv({ cls: 'folio-detached-header', text: 'Detached comments' });
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
		if (!this.listEl) return;
		const cm = this.cm();
		const st = cm?.state.field(folioField, false);
		this.renderHeader();
		if (!cm || !st) {
			this.emptyEl.setText(this.source ? 'Comments are shown for notes in Live Preview or Source mode.' : 'Open a note to see its comments.');
			this.emptyEl.show();
			this.listEl.empty();
			for (const c of this.cards.values()) c.destroy();
			this.cards.clear();
			return;
		}
		if (!st.doc.ok) {
			this.emptyEl.setText(`This note's comment data is damaged: ${st.doc.error ?? ''}`);
			this.emptyEl.show();
			return;
		}
		const showResolved = st.ui.showResolved;
		const vis = (id: string) => !st.doc.threads[id]!.resolved || showResolved;
		const anchored = st.doc.anchored.filter(vis);
		const detached = st.doc.detached.filter(vis);
		this.emptyEl.toggle(anchored.length + detached.length === 0);
		this.emptyEl.setText('No comments in this note. Select text and press Ctrl+Alt+M to add one.');
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
			this.detachedHeader.setText(`Detached comments (${detached.length})`);
			order.push(this.detachedHeader);
			detached.forEach(place);
		}
		const current = Array.from(this.listEl.children);
		if (current.length !== order.length || order.some((el, i) => current[i] !== el)) {
			const focused = document.activeElement;
			this.listEl.replaceChildren(...order);
			if (focused instanceof HTMLElement && this.listEl.contains(focused)) focused.focus();
		}
		const active = st.ui.activeId ? this.cards.get(st.ui.activeId) : undefined;
		if (active) active.el.scrollIntoView({ block: 'nearest' });
	}

	private titleEl: HTMLElement | null = null;
	private resolvedBtn: HTMLElement | null = null;

	private renderHeader(): void {
		const h = this.headerEl;
		if (!this.titleEl) {
			this.titleEl = h.createDiv({ cls: 'folio-sidebar-title' });
			const actions = h.createDiv({ cls: 'folio-sidebar-actions' });
			const add = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Add comment on the selection (Ctrl+Alt+M)' } });
			setIcon(add, 'message-square-plus');
			add.addEventListener('click', () => {
				if (this.source) this.plugin.addComment(this.source);
			});
			this.resolvedBtn = actions.createEl('button', { cls: 'clickable-icon' });
			this.resolvedBtn.addEventListener('click', () => void this.plugin.toggleShowResolved());
		}
		this.titleEl.setText(this.source?.file?.basename ?? 'Comments');
		const on = this.plugin.settings.showResolved;
		const btn = this.resolvedBtn!;
		if (btn.dataset.on !== String(on)) {
			btn.dataset.on = String(on);
			btn.empty();
			setIcon(btn, on ? 'eye-off' : 'check-check');
			btn.setAttr('aria-label', on ? 'Hide resolved comments' : 'Show resolved comments');
			btn.toggleClass('is-active', on);
		}
	}
}
