import { MarkdownView, Menu, Notice, Plugin, type Editor, type MarkdownFileInfo } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { DEFAULT_SETTINGS, FolioSettingTab, type FolioSettings } from './settings';
import { CopyOptionsModal, copyForLLM, selectionOffsets } from './exportCommand';
import { commentExtensions, editorViewOf, folioField } from './cm';
import { defaults as cmDefaults, setShowResolved } from './cm/state';
import { cancelDraft, createComment, repairMarkers, startDraft } from './commentOps';
import { ComposerModal } from './composer';

export default class FolioPlugin extends Plugin {
	settings!: FolioSettings;
	/** Header buttons added per view, so they can be removed again. */
	private headerButtons = new WeakMap<MarkdownView, HTMLElement[]>();
	private viewsWithButtons = new Set<MarkdownView>();

	async onload(): Promise<void> {
		await this.loadSettings();
		cmDefaults.showResolved = this.settings.showResolved;
		this.addSettingTab(new FolioSettingTab(this.app, this));
		this.registerEditorExtension(commentExtensions());
		this.registerExportCommands();
		this.registerCommentCommands();

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				if (!(info instanceof MarkdownView)) return;
				this.fillEditorMenu(menu, editor, info);
			}),
		);
		this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshAllViews()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshAllViews()));
		this.app.workspace.onLayoutReady(() => this.refreshAllViews());
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
		cmDefaults.showResolved = this.settings.showResolved;
		for (const view of this.markdownViews()) {
			const cm = editorViewOf(view);
			if (cm && cm.state.field(folioField, false)) cm.dispatch({ effects: setShowResolved.of(this.settings.showResolved) });
		}
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

	/** Composer for a draft (overridden by the margin in Phase 5 when there is room). */
	openComposer(cm: EditorView, draft: { from: number; to: number }): void {
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
