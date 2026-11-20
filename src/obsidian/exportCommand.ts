import { App, MarkdownView, Modal, Notice, Setting, TFile } from 'obsidian';
import { exportForLLM, exportSummary, findEmbedTargets, type ExportMode, type ExportOptions } from '../core/export';
import { inlineCommentStore } from '../core/commentStore';
import type FolioPlugin from './main';

export interface CopyRequest {
	mode?: ExportMode;
	includeResolved?: boolean;
	selectionOnly?: boolean;
	embeds?: 'inline' | 'reference';
	includePrivate?: boolean;
}

/** Local time as YYYY-MM-DD HH:mm. */
export function localDate(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return iso;
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Current selection of the view's editor as document offsets, or null if empty. */
export function selectionOffsets(view: MarkdownView): { from: number; to: number } | null {
	if (view.getMode() !== 'source') return null;
	const ed = view.editor;
	const from = ed.posToOffset(ed.getCursor('from'));
	const to = ed.posToOffset(ed.getCursor('to'));
	return from === to ? null : { from, to };
}

async function loadEmbeds(app: App, md: string, file: TFile): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const target of findEmbedTargets(md)) {
		const dest = app.metadataCache.getFirstLinkpathDest(target, file.path);
		if (dest instanceof TFile && dest.extension === 'md' && dest.path !== file.path) {
			out.set(target, await app.vault.cachedRead(dest));
		}
	}
	return out;
}

export async function copyForLLM(plugin: FolioPlugin, view: MarkdownView, req: CopyRequest = {}): Promise<void> {
	const file = view.file;
	if (!file) return;
	const s = plugin.settings;
	const md = view.getViewData();
	const doc = inlineCommentStore.read(md);
	if (!doc.ok) new Notice(`Folio: ${doc.error}. Exporting the text without comments.`);
	const selection = req.selectionOnly ? selectionOffsets(view) : null;
	if (req.selectionOnly && !selection) {
		new Notice('Folio: nothing is selected.');
		return;
	}
	const embedMode = req.embeds ?? s.exportEmbeds;
	const embeds = embedMode === 'inline' ? await loadEmbeds(plugin.app, md, file) : new Map<string, string>();
	const options: ExportOptions = {
		title: file.basename,
		mode: req.mode ?? 'full',
		includeResolved: req.includeResolved ?? s.exportIncludeResolved,
		selection,
		embeds: embedMode,
		includePrivate: req.includePrivate ?? s.exportIncludePrivate,
		resolveEmbed: (t) => embeds.get(t) ?? null,
		formatDate: localDate,
	};
	const result = exportForLLM(md, doc.threads, options);
	try {
		await navigator.clipboard.writeText(result.text);
	} catch (e) {
		new Notice(`Folio: could not write to the clipboard (${(e as Error).message}).`);
		return;
	}
	new Notice(exportSummary(result.stats, options.mode));
}

/** "Copy for LLM…" with all options. */
export class CopyOptionsModal extends Modal {
	private req: Required<CopyRequest>;

	constructor(private plugin: FolioPlugin, private view: MarkdownView) {
		super(plugin.app);
		const s = plugin.settings;
		this.req = {
			mode: 'full',
			includeResolved: s.exportIncludeResolved,
			selectionOnly: selectionOffsets(view) !== null,
			embeds: s.exportEmbeds,
			includePrivate: s.exportIncludePrivate,
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle('Copy for LLM');
		new Setting(contentEl).setName('Content').addDropdown((d) =>
			d
				.addOptions({ full: 'Text and comments', text: 'Text only (no comments)', comments: 'Comments only' })
				.setValue(this.req.mode)
				.onChange((v) => (this.req.mode = v as ExportMode)),
		);
		const hasSelection = selectionOffsets(this.view) !== null;
		new Setting(contentEl)
			.setName('Current selection only')
			.setDesc(hasSelection ? 'Only the selected text, and only threads that intersect it.' : 'Nothing is selected.')
			.addToggle((t) => t.setValue(this.req.selectionOnly).setDisabled(!hasSelection).onChange((v) => (this.req.selectionOnly = v)));
		new Setting(contentEl).setName('Include resolved threads').addToggle((t) => t.setValue(this.req.includeResolved).onChange((v) => (this.req.includeResolved = v)));
		new Setting(contentEl).setName('Embedded notes').addDropdown((d) =>
			d
				.addOptions({ inline: 'Inline their content', reference: 'Reference only' })
				.setValue(this.req.embeds)
				.onChange((v) => (this.req.embeds = v as 'inline' | 'reference')),
		);
		new Setting(contentEl).setName('Include %% private %% comments').addToggle((t) => t.setValue(this.req.includePrivate).onChange((v) => (this.req.includePrivate = v)));
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Copy')
				.setCta()
				.onClick(async () => {
					this.close();
					await copyForLLM(this.plugin, this.view, this.req);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
