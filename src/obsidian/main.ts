import { MarkdownView, Menu, Notice, Plugin, editorInfoField, type Editor, type MarkdownFileInfo } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { DEFAULT_SETTINGS, FolioSettingTab, type FolioSettings } from './settings';
import { CopyOptionsModal, copyForLLM, selectionOffsets } from './exportCommand';
import { commentExtensions, editorViewOf, folioField } from './cm';
import { defaults as cmDefaults, setActive, setShowResolved } from './cm/state';
import { cancelDraft, createComment, ops, repairMarkers, revealThread, startDraft } from './commentOps';
import { ComposerModal } from './composer';
import { marginContext, marginExtensions, marginIsWide, marginPlugin, refreshMargin, type MarginContext } from './margin/marginView';
import { CommentsSidebarView, SIDEBAR_VIEW } from './sidebarView';
import { clearReadingCache, makeReadingPostProcessor } from './reading';

export default class FolioPlugin extends Plugin {
	settings!: FolioSettings;
	/** Header buttons added per view, so they can be removed again. */
	private headerButtons = new WeakMap<MarkdownView, HTMLElement[]>();
	private viewsWithButtons = new Set<MarkdownView>();
	/** Per-thread tree view toggles for this session, keyed by "path\u0000id". */
	private treeState = new Map<string, boolean>();
	private lastMarkdown: MarkdownView | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		cmDefaults.showResolved = this.settings.showResolved;
		this.addSettingTab(new FolioSettingTab(this.app, this));
		this.registerView(SIDEBAR_VIEW, (leaf) => new CommentsSidebarView(leaf, this));
		this.registerEditorExtension(commentExtensions([marginContext.of(this.marginContext()), ...marginExtensions]));
		this.registerExportCommands();
		this.registerCommentCommands();
		this.registerNavigationCommands();
		this.registerMarkdownPostProcessor(makeReadingPostProcessor(() => this.settings.showResolved));
		// Reading view: clicking a highlight shows the thread in the sidebar.
		this.registerDomEvent(document, 'click', (e) => {
			const hl = (e.target as HTMLElement | null)?.closest?.('.markdown-reading-view .folio-hl[data-folio-id]');
			if (!hl) return;
			const id = hl.getAttribute('data-folio-id')!;
			const view = this.markdownViews().find((v) => v.containerEl.contains(hl));
			const cm = editorViewOf(view);
			if (!view || !cm) return;
			this.lastMarkdown = view;
			cm.dispatch({ effects: setActive.of(id) });
			void this.activateSidebar();
		});

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				if (!(info instanceof MarkdownView)) return;
				this.fillEditorMenu(menu, editor, info);
			}),
		);
		this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshAllViews()));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.lastMarkdown = leaf.view;
					this.sidebar()?.setSource(leaf.view);
				}
				this.refreshAllViews();
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.lastMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
			this.refreshAllViews();
		});
	}

	// --- Margin / sidebar plumbing ------------------------------------------

	private marginContext(): MarginContext {
		return {
			app: this.app,
			marginWidth: () => this.settings.marginWidth,
			isMainEditor: (view) => this.markdownViews().some((v) => editorViewOf(v) === view),
			sourcePath: (view) => view.state.field(editorInfoField, false)?.file?.path ?? '',
			isTree: (path, id) => this.isTree(path, id),
			setTree: (path, id, tree) => this.setTree(path, id, tree),
			openSidebar: () => void this.activateSidebar(),
			changed: (view) => {
				const sb = this.sidebar();
				if (sb && editorViewOf(this.lastMarkdown) === view) sb.refresh();
			},
		};
	}

	isTree(path: string, id: string): boolean {
		return this.treeState.get(`${path}\u0000${id}`) ?? this.settings.defaultThreadView === 'tree';
	}

	setTree(path: string, id: string, tree: boolean): void {
		this.treeState.set(`${path}\u0000${id}`, tree);
	}

	lastMarkdownView(): MarkdownView | null {
		if (this.lastMarkdown && this.markdownViews().includes(this.lastMarkdown)) return this.lastMarkdown;
		return this.app.workspace.getActiveViewOfType(MarkdownView) ?? this.markdownViews()[0] ?? null;
	}

	sidebar(): CommentsSidebarView | null {
		const leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
		return leaf && leaf.view instanceof CommentsSidebarView ? leaf.view : null;
	}

	async activateSidebar(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
		if (!leaf) {
			const right = this.app.workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: SIDEBAR_VIEW, active: true });
			leaf = right;
		}
		await this.app.workspace.revealLeaf(leaf);
		this.sidebar()?.setSource(this.lastMarkdownView());
	}

	/** Ask every margin to re-render (e.g. after a tree toggle from the sidebar). */
	refreshMargins(): void {
		for (const v of this.markdownViews()) {
			const cm = editorViewOf(v);
			if (cm) refreshMargin(cm);
		}
	}

	onunload(): void {
		for (const view of this.viewsWithButtons) this.removeHeaderButtons(view);
		this.viewsWithButtons.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<FolioSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		clearReadingCache();
		cmDefaults.showResolved = this.settings.showResolved;
		for (const view of this.markdownViews()) {
			const cm = editorViewOf(view);
			if (cm && cm.state.field(folioField, false)) cm.dispatch({ effects: setShowResolved.of(this.settings.showResolved) });
		}
		this.refreshMargins();
		this.refreshAllViews();
	}

	/** Markdown views in all windows. */
	markdownViews(): MarkdownView[] {
		return this.app.workspace
			.getLeavesOfType('markdown')
			.map((l) => l.view)
			.filter((v): v is MarkdownView => v instanceof MarkdownView);
	}

	refreshAllViews(): void {
		for (const view of this.markdownViews()) this.refreshView(view);
	}

	refreshView(view: MarkdownView): void {
		this.syncHeaderButtons(view);
	}

	// --- Copy for LLM -------------------------------------------------------

	private registerExportCommands(): void {
		const withView = (fn: (view: MarkdownView) => void) => (checking: boolean) => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) return false;
			if (!checking) fn(view);
			return true;
		};
		this.addCommand({
			id: 'copy-for-llm',
			name: 'Copy for LLM',
			hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'c' }],
			checkCallback: withView((v) => void copyForLLM(this, v)),
		});
		this.addCommand({
			id: 'copy-for-llm-options',
			name: 'Copy for LLM (choose options)…',
			checkCallback: withView((v) => new CopyOptionsModal(this, v).open()),
		});
		this.addCommand({
			id: 'copy-for-llm-selection',
			name: 'Copy selection for LLM',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file || !selectionOffsets(view)) return false;
				if (!checking) void copyForLLM(this, view, { selectionOnly: true });
				return true;
			},
		});
		this.addCommand({
			id: 'copy-for-llm-with-resolved',
			name: 'Copy for LLM including resolved comments',
			checkCallback: withView((v) => void copyForLLM(this, v, { includeResolved: true })),
		});
		this.addCommand({
			id: 'copy-for-llm-comments-only',
			name: 'Copy comments only for LLM',
			checkCallback: withView((v) => void copyForLLM(this, v, { mode: 'comments' })),
		});
		this.addCommand({
			id: 'copy-for-llm-text-only',
			name: 'Copy text only for LLM (no comments)',
			checkCallback: withView((v) => void copyForLLM(this, v, { mode: 'text' })),
		});
	}

	// --- Keyboard navigation (phase 6) -----------------------------------------

	private registerNavigationCommands(): void {
		const withCm = (fn: (cm: EditorView, view: MarkdownView) => void) => (checking: boolean, _e: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const cm = ctx instanceof MarkdownView ? editorViewOf(ctx) : null;
			if (!cm || !(ctx instanceof MarkdownView) || !cm.state.field(folioField, false)) return false;
			if (!checking) fn(cm, ctx);
			return true;
		};
		this.addCommand({
			id: 'next-comment',
			name: 'Go to next comment',
			hotkeys: [{ modifiers: ['Mod', 'Alt'], key: '.' }],
			editorCheckCallback: withCm((cm) => this.jumpComment(cm, 1)),
		});
		this.addCommand({
			id: 'previous-comment',
			name: 'Go to previous comment',
			hotkeys: [{ modifiers: ['Mod', 'Alt'], key: ',' }],
			editorCheckCallback: withCm((cm) => this.jumpComment(cm, -1)),
		});
		this.addCommand({
			id: 'reply-active-comment',
			name: 'Reply to the active comment',
			editorCheckCallback: withCm((cm, view) => {
				const id = cm.state.field(folioField).ui.activeId;
				if (!id) {
					new Notice('Folio: no active comment. Put the cursor in commented text first.');
					return;
				}
				const card = marginIsWide(cm) ? cm.plugin(marginPlugin)?.card(id) : undefined;
				if (card) card.focusReply();
				else {
					this.lastMarkdown = view;
					void this.activateSidebar().then(() => window.setTimeout(() => this.sidebar()?.focusReply(id), 50));
				}
			}),
		});
		this.addCommand({
			id: 'resolve-active-comment',
			name: 'Resolve the active comment',
			editorCheckCallback: withCm((cm) => {
				const id = cm.state.field(folioField).ui.activeId;
				if (id) ops.resolve(cm, id, true);
				else new Notice('Folio: no active comment.');
			}),
		});
	}

	/** Select the next/previous visible thread after/before the cursor (wrapping around). */
	jumpComment(cm: EditorView, dir: 1 | -1): void {
		const st = cm.state.field(folioField);
		const ids = st.doc.anchored.filter((id) => !st.doc.threads[id]!.resolved || st.ui.showResolved);
		if (!ids.length) {
			new Notice('Folio: no comments in this note.');
			return;
		}
		const pos = (id: string) => st.doc.markers.anchors.get(id)!.textFrom;
		const head = cm.state.selection.main.from;
		const current = st.ui.activeId && ids.includes(st.ui.activeId) ? pos(st.ui.activeId) : null;
		const ref = current ?? head;
		let target: string | undefined;
		if (dir > 0) target = ids.find((id) => pos(id) > ref) ?? ids[0];
		else target = [...ids].reverse().find((id) => pos(id) < ref) ?? ids[ids.length - 1];
		if (target) revealThread(cm, target, { select: true, focus: true });
	}

	// --- Comments -------------------------------------------------------------

	/** Start a new comment on the selection in `view`. */
	addComment(view: MarkdownView): void {
		const cm = editorViewOf(view);
		if (!cm || view.getMode() !== 'source') {
			new Notice('Folio: switch to Live Preview or Source mode to add a comment.');
			return;
		}
		const draft = startDraft(cm);
		if (!draft) return;
		this.openComposer(cm, draft);
	}

	/** The margin shows a draft card when there is room; otherwise a modal opens. */
	openComposer(cm: EditorView, draft: { from: number; to: number }): void {
		if (marginIsWide(cm)) return;
		const quote = cm.state.sliceDoc(draft.from, draft.to).replace(/\u200b?<!--\/?c:[A-Za-z0-9]+-->/g, '');
		new ComposerModal(this.app, 'Add comment', quote.length > 300 ? quote.slice(0, 300) + '…' : quote, {
			placeholder: 'Comment…',
			submitLabel: 'Comment',
			onSubmit: (text) => createComment(cm, text, draft),
			onCancel: () => cancelDraft(cm),
		}).open();
	}

	async toggleShowResolved(): Promise<void> {
		this.settings.showResolved = !this.settings.showResolved;
		await this.saveSettings();
		new Notice(this.settings.showResolved ? 'Folio: showing resolved comments' : 'Folio: hiding resolved comments');
	}

	private registerCommentCommands(): void {
		this.addCommand({
			id: 'add-comment',
			name: 'Add comment',
			hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'm' }],
			editorCheckCallback: (checking, _editor, ctx) => {
				if (!(ctx instanceof MarkdownView)) return false;
				if (!checking) this.addComment(ctx);
				return true;
			},
		});
		this.addCommand({
			id: 'open-comments-sidebar',
			name: 'Open comments sidebar',
			callback: () => void this.activateSidebar(),
		});
		this.addCommand({
			id: 'toggle-show-resolved',
			name: 'Toggle show resolved comments',
			callback: () => void this.toggleShowResolved(),
		});
		this.addCommand({
			id: 'repair-markers',
			name: 'Repair comment markers in this note',
			editorCheckCallback: (checking, _editor, ctx) => {
				const cm = ctx instanceof MarkdownView ? editorViewOf(ctx) : null;
				if (!cm) return false;
				if (!checking) {
					const n = repairMarkers(cm);
					new Notice(n ? `Folio: removed ${n} damaged marker${n === 1 ? '' : 's'}.` : 'Folio: no damaged markers found.');
				}
				return true;
			},
		});
	}

	private fillEditorMenu(menu: Menu, editor: Editor, view: MarkdownView): void {
		const hasSelection = editor.somethingSelected();
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Add comment')
				.setIcon('message-square-plus')
				.setSection('folio')
				.onClick(() => this.addComment(view)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Copy for LLM')
				.setIcon('clipboard-copy')
				.setSection('folio')
				.onClick(() => void copyForLLM(this, view)),
		);
		if (hasSelection) {
			menu.addItem((item) =>
				item
					.setTitle('Copy selection for LLM')
					.setIcon('clipboard-paste')
					.setSection('folio')
					.onClick(() => void copyForLLM(this, view, { selectionOnly: true })),
			);
		}
	}

	// --- Header buttons -----------------------------------------------------

	private syncHeaderButtons(view: MarkdownView): void {
		const want = this.settings.showHeaderButtons;
		const have = this.headerButtons.has(view);
		if (want && !have) {
			const copy = view.addAction('clipboard-copy', 'Copy for LLM', () => void copyForLLM(this, view));
			const comment = view.addAction('message-square-plus', 'Add comment (Ctrl+Alt+M)', () => this.addComment(view));
			copy.addClass('folio-header-button');
			comment.addClass('folio-header-button');
			this.headerButtons.set(view, [copy, comment]);
			this.viewsWithButtons.add(view);
		} else if (!want && have) {
			this.removeHeaderButtons(view);
		}
	}

	private removeHeaderButtons(view: MarkdownView): void {
		for (const el of this.headerButtons.get(view) ?? []) el.remove();
		this.headerButtons.delete(view);
		this.viewsWithButtons.delete(view);
	}
}
