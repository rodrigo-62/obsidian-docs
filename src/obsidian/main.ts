import { MarkdownView, Menu, Notice, Plugin, TFile, TFolder, editorInfoField, normalizePath, type Editor, type MarkdownFileInfo } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { DEFAULT_SETTINGS, FolioSettingTab, type FolioSettings } from './settings';
import { CopyOptionsModal, copyForLLM, selectionOffsets } from './exportCommand';
import { commentExtensions, editorViewOf, folioField } from './cm';
import { defaults as cmDefaults, setActive, setShowResolved } from './cm/state';
import { cancelDraft, createComment, ops, repairMarkers, revealThread, startDraft } from './commentOps';
import { ComposerModal } from './composer';
import { marginContext, marginExtensions, marginIsWide, marginPlugin, refreshMargin, type MarginContext } from './margin/marginView';
import { CommentsSidebarView, SIDEBAR_VIEW } from './sidebarView';
import { clearReadingCache, makeReadingPostProcessor } from './reading';
import { installSearchScope } from './searchScope';
import { KEYS, LEGACY_KEYS, hasLegacyKeys, migrateFrontmatter, readDocSettings, stepFontSize, stepZoom, toFrontmatter, type DocSettings, type PageSettings } from '../core/docSettings';
import { applyPageStyle, clearAllPageStyles } from './pageStyle';
import { DocToolbar, THEME_ORDER } from './toolbar';
import { clampTweak } from '../core/paperPalette';
import { footnoteAction } from '../core/footnotes';
import { BLOCK_OPEN, LEGACY_BLOCK_OPENS, findThreadBlock } from '../core/threadStore';
import { stripMarkers } from '../core/markers';
import { adjacentHeading } from '../core/headings';

export default class FolioPlugin extends Plugin {
	settings!: FolioSettings;
	/** Header buttons added per view, so they can be removed again. */
	private headerButtons = new WeakMap<MarkdownView, HTMLElement[]>();
	private viewsWithButtons = new Set<MarkdownView>();
	/** Per-thread tree view toggles for this session, keyed by "path\u0000id". */
	private treeState = new Map<string, boolean>();
	private lastMarkdown: MarkdownView | null = null;
	private toolbars = new Map<MarkdownView, DocToolbar>();
	/** Settings applied before the metadata cache has caught up with a frontmatter write (keeps zooming instant). */
	private optimistic = new Map<string, { s: DocSettings; at: number }>();
	private writeTimers = new Map<string, number>();
	private pendingPatch = new Map<string, Partial<DocSettings>>();

	async onload(): Promise<void> {
		await this.loadSettings();
		cmDefaults.showResolved = this.settings.showResolved;
		this.addSettingTab(new FolioSettingTab(this.app, this));
		this.registerView(SIDEBAR_VIEW, (leaf) => new CommentsSidebarView(leaf, this));
		this.registerEditorExtension(commentExtensions([marginContext.of(this.marginContext()), ...marginExtensions]));
		installSearchScope(this);
		this.registerExportCommands();
		this.registerCommentCommands();
		this.registerNavigationCommands();
		this.registerDocModeCommands();
		this.addRibbonIcon('file-text', 'New doc', () => void this.createDoc());
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((i) =>
					i
						.setTitle('New doc')
						.setIcon('file-text')
						.setSection('action-primary')
						.onClick(() => void this.createDoc(file)),
				);
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (!this.pendingPatch.has(file.path)) this.optimistic.delete(file.path);
				for (const v of this.markdownViews()) if (v.file?.path === file.path) this.refreshView(v);
			}),
		);
		this.registerEvent(this.app.workspace.on('file-open', () => this.refreshAllViews()));
		this.registerDomEvent(activeDocument, 'wheel', (e) => this.onWheel(e), { passive: false });
		this.registerMarkdownPostProcessor(makeReadingPostProcessor(() => this.settings.showResolved));
		// Reading view: clicking a highlight shows the thread in the sidebar.
		this.registerDomEvent(activeDocument, 'click', (e) => {
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
			commentFontSize: () => this.settings.commentFontSize,
			isMainEditor: (view) => this.markdownViews().some((v) => editorViewOf(v) === view),
			sourcePath: (view) => view.state.field(editorInfoField, false)?.file?.path ?? '',
			isTree: (path, id) => this.isTree(path, id),
			setTree: (path, id, tree) => this.setTree(path, id, tree),
			openSidebar: () => void this.activateSidebar(),
			changed: (view) => {
				// Compare with the note the sidebar shows (lastMarkdown can be unset, e.g. after a reload while the sidebar had focus).
				const sb = this.sidebar();
				if (sb?.shows(view)) sb.refresh();
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
		const source = this.lastMarkdownView();
		let leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)[0];
		if (!leaf) {
			const right = this.app.workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: SIDEBAR_VIEW, active: true });
			leaf = right;
		}
		await this.app.workspace.revealLeaf(leaf);
		// Sidebar tabs restored from a saved layout are "deferred" until loaded (Obsidian 1.7+).
		await (leaf as unknown as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
		const view = leaf.view;
		if (view instanceof CommentsSidebarView) view.setSource(source);
	}

	/** Open the Comments sidebar with its search focused, starting from the editor's selection if it is a short one-line text. */
	async searchComments(): Promise<void> {
		const sel = stripMarkers(this.lastMarkdownView()?.editor?.getSelection() ?? '');
		const text = sel && sel.length <= 200 && !sel.includes('\n') ? sel : undefined;
		await this.activateSidebar();
		this.sidebar()?.focusSearch(text);
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
		for (const t of this.toolbars.values()) t.destroy();
		this.toolbars.clear();
		clearAllPageStyles();
		for (const t of this.writeTimers.values()) window.clearTimeout(t);
	}

	async loadSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<FolioSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		const t = data.themeTweaks;
		this.settings.themeTweaks = {
			light: clampTweak('light', t?.light),
			sepia: clampTweak('sepia', t?.sepia),
			dark: clampTweak('dark', t?.dark),
		};
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
		const s = view.file ? this.docSettings(view.file) : null;
		applyPageStyle(view, s, this.settings.themeTweaks);
		this.syncToolbar(view, s);
	}

	// --- Doc mode (phase 1) ---------------------------------------------------

	private pageDefaults(): PageSettings {
		const d = this.settings;
		return { zoom: d.defaultZoom, width: d.defaultWidth, font: d.defaultFont, fontSize: d.defaultFontSize, theme: d.defaultTheme };
	}

	docSettings(file: TFile): DocSettings {
		const o = this.optimistic.get(file.path);
		if (o && Date.now() - o.at < 5000) return o.s;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return readDocSettings(fm, this.pageDefaults());
	}

	private syncToolbar(view: MarkdownView, s: DocSettings | null): void {
		let tb = this.toolbars.get(view);
		if (!s?.enabled) {
			if (tb) {
				tb.destroy();
				this.toolbars.delete(view);
			}
			return;
		}
		if (!tb || !view.contentEl.contains(tb.el)) {
			tb?.destroy();
			tb = new DocToolbar(this.app, view, {
				update: (patch) => view.file && this.updateDocSettings(view.file, patch),
				addComment: () => this.addComment(view),
				copyForLLM: () => void copyForLLM(this, view),
				copyOptions: () => new CopyOptionsModal(this, view).open(),
				toggleResolved: () => void this.toggleShowResolved(),
				commentFontSize: () => this.settings.commentFontSize,
				setCommentFontSize: (px) => {
					this.settings.commentFontSize = px;
					void this.saveSettings().then(() => this.sidebar()?.refresh());
				},
				showResolved: () => this.settings.showResolved,
				openSidebar: () => {
					this.lastMarkdown = view;
					void this.activateSidebar();
				},
			});
			this.toolbars.set(view, tb);
		}
		tb.update(s);
		// forget toolbars of closed views
		for (const v of [...this.toolbars.keys()]) if (!this.markdownViews().includes(v)) {
			this.toolbars.get(v)?.destroy();
			this.toolbars.delete(v);
		}
	}

	/** Apply a change immediately, then write it to the note's frontmatter (debounced). */
	updateDocSettings(file: TFile, patch: Partial<DocSettings>, delay = 0): void {
		const next = { ...this.docSettings(file), ...patch };
		this.optimistic.set(file.path, { s: next, at: Date.now() });
		for (const v of this.markdownViews()) if (v.file?.path === file.path) this.refreshView(v);
		this.pendingPatch.set(file.path, { ...(this.pendingPatch.get(file.path) ?? {}), ...patch });
		window.clearTimeout(this.writeTimers.get(file.path));
		this.writeTimers.set(
			file.path,
			window.setTimeout(() => {
				this.writeTimers.delete(file.path);
				const p = this.pendingPatch.get(file.path) ?? {};
				this.pendingPatch.delete(file.path);
				void this.app.fileManager
					.processFrontMatter(file, (fm: Record<string, unknown>) => {
						migrateFrontmatter(fm);
						Object.assign(fm, toFrontmatter(p));
						if (p.font === '') delete fm[KEYS.font];
					})
					.catch((e: Error) => new Notice(`Docs: could not update the frontmatter (${e.message}).`));
			}, delay),
		);
	}

	private resetDocKey(file: TFile, key: keyof typeof KEYS): void {
		this.optimistic.delete(file.path);
		void this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			migrateFrontmatter(fm);
			delete fm[KEYS[key]];
			delete fm[LEGACY_KEYS[key]];
		});
	}

	/** Create "Untitled doc.md" with doc mode on, like Obsidian's New note. */
	async createDoc(folder?: TFolder): Promise<void> {
		const parent = folder ?? this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '');
		const base = parent.isRoot() ? '' : `${parent.path}/`;
		let path = normalizePath(`${base}Untitled doc.md`);
		for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${base}Untitled doc ${i}.md`);
		const file = await this.app.vault.create(path, `---\n${KEYS.enabled}: true\n---\n\n`);
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { active: true, state: { mode: 'source' }, eState: { rename: 'all' } });
	}

	async toggleDocMode(file: TFile): Promise<void> {
		this.optimistic.delete(file.path);
		let on = false;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			migrateFrontmatter(fm);
			if (readDocSettings(fm).enabled) delete fm[KEYS.enabled];
			else {
				fm[KEYS.enabled] = true;
				on = true;
			}
		});
		new Notice(on ? 'Docs: doc mode on' : 'Docs: doc mode off');
	}

	/**
	 * Convert every note from the old Folio format: `folio*` frontmatter keys become
	 * `docs*`, and `<!--folio:threads` becomes `<!--docs:threads`. Notes keep working
	 * without this (old names are still read); it just tidies the files in one go.
	 */
	async upgradeLegacyNotes(): Promise<void> {
		let keys = 0;
		let blocks = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (hasLegacyKeys(fm)) {
				await this.app.fileManager.processFrontMatter(file, (f: Record<string, unknown>) => {
					if (migrateFrontmatter(f)) keys++;
				});
			}
			const text = await this.app.vault.cachedRead(file);
			if (!LEGACY_BLOCK_OPENS.some((o) => text.includes(o))) continue;
			await this.app.vault.process(file, (md) => {
				const b = findThreadBlock(md);
				if (!b?.legacy) return md;
				const opener = LEGACY_BLOCK_OPENS.find((o) => md.startsWith(o, b.from))!;
				blocks++;
				return md.slice(0, b.from) + BLOCK_OPEN + md.slice(b.from + opener.length);
			});
		}
		clearReadingCache();
		new Notice(keys + blocks ? `Docs: upgraded ${keys} note${keys === 1 ? '' : 's'} with old settings keys and ${blocks} with old comment blocks.` : 'Docs: no notes in the old Folio format.');
	}

	private registerDocModeCommands(): void {
		this.addCommand({ id: 'upgrade-folio-notes', name: 'Upgrade notes from the old Folio format', callback: () => void this.upgradeLegacyNotes() });
		const withFile = (needDoc: boolean, fn: (file: TFile, s: DocSettings, view: MarkdownView) => void) => (checking: boolean) => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!view || !file) return false;
			const s = this.docSettings(file);
			if (needDoc && !s.enabled) return false;
			if (!checking) fn(file, s, view);
			return true;
		};
		this.addCommand({ id: 'new-doc', name: 'Create new doc', callback: () => void this.createDoc() });
		this.addCommand({ id: 'toggle-doc-mode', name: 'Toggle doc mode for this note', checkCallback: withFile(false, (f) => void this.toggleDocMode(f)) });
		this.addCommand({ id: 'zoom-in', name: 'Zoom in (doc mode)', checkCallback: withFile(true, (f, s) => this.updateDocSettings(f, { zoom: stepZoom(s.zoom, 1) }, 300)) });
		this.addCommand({ id: 'zoom-out', name: 'Zoom out (doc mode)', checkCallback: withFile(true, (f, s) => this.updateDocSettings(f, { zoom: stepZoom(s.zoom, -1) }, 300)) });
		this.addCommand({ id: 'zoom-reset', name: 'Reset zoom (doc mode)', checkCallback: withFile(true, (f) => this.resetDocKey(f, 'zoom')) });
		this.addCommand({ id: 'font-bigger', name: 'Increase font size (doc mode)', checkCallback: withFile(true, (f, s) => this.updateDocSettings(f, { fontSize: stepFontSize(s.fontSize, 1) }, 300)) });
		this.addCommand({ id: 'font-smaller', name: 'Decrease font size (doc mode)', checkCallback: withFile(true, (f, s) => this.updateDocSettings(f, { fontSize: stepFontSize(s.fontSize, -1) }, 300)) });
		this.addCommand({
			id: 'cycle-page-theme',
			name: 'Change page theme (app / light / sepia / dark)',
			checkCallback: withFile(true, (f, s) => {
				this.updateDocSettings(f, { theme: THEME_ORDER[(THEME_ORDER.indexOf(s.theme) + 1) % THEME_ORDER.length] });
			}),
		});
	}

	/** Ctrl+Alt+scroll zooms a doc-mode note. */
	private onWheel(e: WheelEvent): void {
		if (!e.ctrlKey || !e.altKey || !this.settings.ctrlAltScrollZoom) return;
		const target = e.target as HTMLElement | null;
		const view = this.markdownViews().find((v) => target && v.contentEl.contains(target));
		const file = view?.file;
		if (!view || !file) return;
		const s = this.docSettings(file);
		if (!s.enabled) return;
		e.preventDefault();
		const zoom = stepZoom(s.zoom, e.deltaY < 0 ? 1 : -1);
		if (zoom !== s.zoom) this.updateDocSettings(file, { zoom }, 500);
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

	// --- Footnotes: insert / jump (Ctrl+Alt+F) ---------------------------------

	/** Where to return from a definition, per editor: the reference we came from. */
	private footnoteOrigin = new WeakMap<EditorView, { label: string; pos: number }>();

	footnote(cm: EditorView): void {
		const md = cm.state.doc.toString();
		const head = cm.state.selection.main.head;
		const a = footnoteAction(md, head);
		const scroll = (pos: number) => EditorView.scrollIntoView(pos, { y: 'center' });
		if (a.kind === 'toReference') {
			// prefer the exact reference we came from, if it still points at this footnote
			const o = this.footnoteOrigin.get(cm);
			const ref = `[^${a.label}]`;
			const pos = o && o.label === a.label && md.slice(o.pos - ref.length, o.pos) === ref ? o.pos : a.pos;
			cm.dispatch({ selection: { anchor: pos }, effects: scroll(pos), userEvent: 'select' });
		} else if (a.kind === 'toDefinition') {
			this.footnoteOrigin.set(cm, { label: a.label, pos: a.refEnd });
			cm.dispatch({ changes: a.changes, selection: { anchor: a.pos }, effects: scroll(a.pos), userEvent: 'select' });
		} else {
			this.footnoteOrigin.set(cm, { label: a.label, pos: a.refEnd });
			cm.dispatch({ changes: a.changes, selection: { anchor: a.cursor }, effects: scroll(a.cursor), userEvent: 'input.footnote' });
		}
		cm.focus();
	}

	// --- Keyboard navigation (phase 6) -----------------------------------------

	private registerNavigationCommands(): void {
		const withCm = (fn: (cm: EditorView, view: MarkdownView) => void) => (checking: boolean, _e: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const cm = ctx instanceof MarkdownView ? editorViewOf(ctx) : null;
			if (!cm || !(ctx instanceof MarkdownView) || !cm.state.field(folioField, false)) return false;
			if (!checking) fn(cm, ctx);
			return true;
		};
		const jumpHeading = (dir: 1 | -1) =>
			withCm((cm) => {
				const h = adjacentHeading(cm.state.doc.toString(), cm.state.selection.main.head, dir);
				if (!h) {
					new Notice(dir > 0 ? 'Docs: no heading below.' : 'Docs: no heading above.');
					return;
				}
				cm.dispatch({ selection: { anchor: h.text }, effects: EditorView.scrollIntoView(h.text, { y: 'start', yMargin: 60 }), userEvent: 'select' });
				cm.focus();
			});
		this.addCommand({ id: 'next-heading', name: 'Go to next heading', editorCheckCallback: jumpHeading(1) });
		this.addCommand({ id: 'previous-heading', name: 'Go to previous heading', editorCheckCallback: jumpHeading(-1) });
		this.addCommand({
			id: 'footnote',
			name: 'Insert footnote, or jump between a footnote and its reference',
			editorCheckCallback: (checking, _e, ctx) => {
				const cm = ctx instanceof MarkdownView ? editorViewOf(ctx) : null;
				if (!cm || !(ctx instanceof MarkdownView) || ctx.getMode() !== 'source') return false;
				if (!checking) this.footnote(cm);
				return true;
			},
		});
		this.addCommand({
			id: 'next-comment',
			name: 'Go to next comment',
			editorCheckCallback: withCm((cm) => this.jumpComment(cm, 1)),
		});
		this.addCommand({
			id: 'previous-comment',
			name: 'Go to previous comment',
			editorCheckCallback: withCm((cm) => this.jumpComment(cm, -1)),
		});
		this.addCommand({
			id: 'reply-active-comment',
			name: 'Reply to the active comment',
			editorCheckCallback: withCm((cm, view) => {
				const id = cm.state.field(folioField).ui.activeId;
				if (!id) {
					new Notice('Docs: no active comment. Put the cursor in commented text first.');
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
				else new Notice('Docs: no active comment.');
			}),
		});
	}

	/** Select the next/previous visible thread after/before the cursor (wrapping around). */
	jumpComment(cm: EditorView, dir: 1 | -1): void {
		const st = cm.state.field(folioField);
		const ids = st.doc.anchored.filter((id) => !st.doc.threads[id]!.resolved || st.ui.showResolved);
		if (!ids.length) {
			new Notice('Docs: no comments in this note.');
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
			new Notice('Docs: switch to Live Preview or Source mode to add a comment.');
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
			priority: 'normal',
			onSubmit: (text, { priority }) => createComment(cm, text, draft, priority),
			onCancel: () => cancelDraft(cm),
		}).open();
	}

	async toggleShowResolved(): Promise<void> {
		this.settings.showResolved = !this.settings.showResolved;
		await this.saveSettings();
		new Notice(this.settings.showResolved ? 'Docs: showing resolved comments' : 'Docs: hiding resolved comments');
	}

	private registerCommentCommands(): void {
		this.addCommand({
			id: 'add-comment',
			name: 'Add comment',
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
			id: 'search-comments',
			name: 'Search comments',
			callback: () => void this.searchComments(),
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
					new Notice(n ? `Docs: removed ${n} damaged marker${n === 1 ? '' : 's'}.` : 'Docs: no damaged markers found.');
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
