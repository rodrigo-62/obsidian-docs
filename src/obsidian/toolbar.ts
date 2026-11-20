// The doc-mode toolbar (SPEC §4.5): a slim bar at the top of the view.

import { App, Modal, Setting, setIcon, type MarkdownView } from 'obsidian';
import { LIMITS, WIDTH_PRESETS, ZOOM_STEPS, stepFontSize, type DocSettings, type ThemeChoice } from '../core/docSettings';
import { CURATED_FONTS, FONT_ALTERNATIVES, isFontInstalled, querySystemFonts } from './fonts';

export interface ToolbarActions {
	update(patch: Partial<DocSettings>): void;
	addComment(): void;
	copyForLLM(): void;
	copyOptions(): void;
	toggleResolved(): void;
	showResolved(): boolean;
	openSidebar(): void;
}

let systemFonts: string[] | null = null;

class PromptModal extends Modal {
	constructor(app: App, private title: string, private initial: string, private onDone: (v: string) => void) {
		super(app);
	}
	onOpen(): void {
		this.setTitle(this.title);
		let value = this.initial;
		new Setting(this.contentEl).addText((t) => {
			t.setValue(this.initial).onChange((v) => (value = v));
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.close();
					this.onDone(value.trim());
				}
			});
			window.setTimeout(() => t.inputEl.select(), 0);
		});
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText('OK')
				.setCta()
				.onClick(() => {
					this.close();
					this.onDone(value.trim());
				}),
		);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

const THEME_ORDER: ThemeChoice[] = ['app', 'light', 'dark'];
const THEME_LABEL: Record<ThemeChoice, string> = { app: 'Page theme: follow the app', light: 'Page theme: paper light', dark: 'Page theme: paper dark' };
const THEME_ICON: Record<ThemeChoice, string> = { app: 'monitor', light: 'sun', dark: 'moon' };

export class DocToolbar {
	readonly el: HTMLElement;
	private zoomSel: HTMLSelectElement;
	private fontSel: HTMLSelectElement;
	private sizeVal: HTMLElement;
	private widthSel: HTMLSelectElement;
	private themeBtn: HTMLElement;
	private resolvedBtn: HTMLElement;
	private current: DocSettings | null = null;

	constructor(private app: App, view: MarkdownView, private actions: ToolbarActions) {
		this.el = createDiv({ cls: 'folio-toolbar' });
		view.contentEl.prepend(this.el);

		const group = (cls = '') => this.el.createDiv({ cls: `folio-tb-group ${cls}`.trim() });

		// zoom
		const g1 = group();
		this.zoomSel = g1.createEl('select', { cls: 'dropdown folio-tb-zoom', attr: { 'aria-label': 'Zoom' } });
		this.zoomSel.addEventListener('change', () => actions.update({ zoom: Number(this.zoomSel.value) }));

		// font + size
		const g2 = group();
		this.fontSel = g2.createEl('select', { cls: 'dropdown folio-tb-font', attr: { 'aria-label': 'Font' } });
		this.fontSel.addEventListener('change', () => this.onFont());
		const minus = this.button(g2, 'minus', 'Decrease font size');
		this.sizeVal = g2.createEl('button', { cls: 'folio-tb-size', attr: { 'aria-label': 'Font size (pt)' } });
		const plus = this.button(g2, 'plus', 'Increase font size');
		minus.addEventListener('click', () => this.current && actions.update({ fontSize: stepFontSize(this.current.fontSize, -1) }));
		plus.addEventListener('click', () => this.current && actions.update({ fontSize: stepFontSize(this.current.fontSize, 1) }));
		this.sizeVal.addEventListener('click', () => {
			if (!this.current) return;
			new PromptModal(app, 'Font size (pt)', String(this.current.fontSize), (v) => {
				const n = Number(v);
				if (isFinite(n) && n > 0) actions.update({ fontSize: Math.min(LIMITS.fontSize.max, Math.max(LIMITS.fontSize.min, n)) });
			}).open();
		});

		// width
		const g3 = group();
		const wIcon = g3.createSpan({ cls: 'folio-tb-label', attr: { 'aria-label': 'Page width (em)' } });
		setIcon(wIcon, 'move-horizontal');
		this.widthSel = g3.createEl('select', { cls: 'dropdown folio-tb-width', attr: { 'aria-label': 'Page width (em)' } });
		this.widthSel.addEventListener('change', () => {
			if (this.widthSel.value === 'custom') {
				new PromptModal(app, 'Page width (em)', String(this.current?.width ?? 42), (v) => {
					const n = Number(v);
					if (isFinite(n) && n > 0) actions.update({ width: Math.min(LIMITS.width.max, Math.max(LIMITS.width.min, n)) });
					else this.render();
				}).open();
				return;
			}
			actions.update({ width: Number(this.widthSel.value) });
		});

		// theme
		const g4 = group();
		this.themeBtn = this.button(g4, 'monitor', 'Page theme');
		this.themeBtn.addEventListener('click', () => {
			if (!this.current) return;
			const next = THEME_ORDER[(THEME_ORDER.indexOf(this.current.theme) + 1) % THEME_ORDER.length]!;
			actions.update({ theme: next });
		});

		this.el.createDiv({ cls: 'folio-tb-spacer' });

		// comments + export
		const g5 = group('folio-tb-comments');
		this.button(g5, 'message-square-plus', 'Add comment (Ctrl+Alt+M)').addEventListener('click', () => actions.addComment());
		this.resolvedBtn = this.button(g5, 'check-check', 'Show resolved comments');
		this.resolvedBtn.addEventListener('click', () => {
			actions.toggleResolved();
			window.setTimeout(() => this.render(), 50);
		});
		this.button(g5, 'messages-square', 'Comments sidebar').addEventListener('click', () => actions.openSidebar());
		const copy = this.el.createEl('button', { cls: 'folio-tb-copy mod-cta', attr: { 'aria-label': 'Copy the note for an AI agent (Ctrl+Alt+C). Right-click for options.' } });
		setIcon(copy.createSpan(), 'clipboard-copy');
		copy.createSpan({ text: 'Copy for LLM' });
		copy.addEventListener('click', () => actions.copyForLLM());
		copy.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			actions.copyOptions();
		});
	}

	private button(parent: HTMLElement, icon: string, label: string): HTMLElement {
		const b = parent.createEl('button', { cls: 'clickable-icon folio-tb-btn', attr: { 'aria-label': label } });
		setIcon(b, icon);
		return b;
	}

	update(s: DocSettings): void {
		this.current = s;
		this.render();
	}

	private render(): void {
		const s = this.current;
		if (!s) return;
		// zoom
		const zooms = [...new Set([...ZOOM_STEPS, s.zoom])].sort((a, b) => a - b);
		this.zoomSel.empty();
		for (const z of zooms) this.zoomSel.createEl('option', { text: `${z}%`, attr: { value: String(z) } });
		this.zoomSel.value = String(s.zoom);
		// font
		this.renderFonts(s.font);
		// size
		this.sizeVal.setText(String(s.fontSize));
		// width
		const widths = [...new Set([...WIDTH_PRESETS, s.width])].sort((a, b) => a - b);
		this.widthSel.empty();
		for (const w of widths) this.widthSel.createEl('option', { text: `${w} em`, attr: { value: String(w) } });
		this.widthSel.createEl('option', { text: 'Custom…', attr: { value: 'custom' } });
		this.widthSel.value = String(s.width);
		// theme
		this.themeBtn.empty();
		setIcon(this.themeBtn, THEME_ICON[s.theme]);
		this.themeBtn.setAttr('aria-label', `${THEME_LABEL[s.theme]} (click to change)`);
		// resolved
		const on = this.actions.showResolved();
		this.resolvedBtn.toggleClass('is-active', on);
		this.resolvedBtn.setAttr('aria-label', on ? 'Hide resolved comments' : 'Show resolved comments');
	}

	private renderFonts(current: string): void {
		const sel = this.fontSel;
		sel.empty();
		sel.createEl('option', { text: 'App font', attr: { value: '' } });
		const list = [...new Set([...(current ? [current] : []), ...CURATED_FONTS, ...(systemFonts ?? [])])];
		const g = sel.createEl('optgroup', { attr: { label: systemFonts ? 'Fonts' : 'Suggested fonts' } });
		for (const f of list) {
			const ok = isFontInstalled(f);
			const opt = g.createEl('option', { text: ok ? f : `${f} (not installed)`, attr: { value: f } });
			if (!ok && FONT_ALTERNATIVES[f]) opt.title = `Not installed. Free metric-compatible alternative: ${FONT_ALTERNATIVES[f]}`;
			opt.style.fontFamily = `"${f}"`;
		}
		const more = sel.createEl('optgroup', { attr: { label: 'More' } });
		more.createEl('option', { text: 'Custom font name…', attr: { value: '__custom' } });
		if (!systemFonts) more.createEl('option', { text: 'List installed fonts…', attr: { value: '__system' } });
		sel.value = current;
		sel.title = current && !isFontInstalled(current) ? `"${current}" is not installed${FONT_ALTERNATIVES[current] ? ` — try ${FONT_ALTERNATIVES[current]}` : ''}` : '';
		sel.toggleClass('is-missing', !!current && !isFontInstalled(current));
	}

	private onFont(): void {
		const v = this.fontSel.value;
		if (v === '__custom') {
			new PromptModal(this.app, 'Font family name', this.current?.font ?? '', (name) => {
				if (name) this.actions.update({ font: name });
				else this.render();
			}).open();
			return;
		}
		if (v === '__system') {
			void querySystemFonts().then((fonts) => {
				systemFonts = fonts && fonts.length ? fonts : null;
				if (!systemFonts) new PromptModal(this.app, 'Listing installed fonts is not available here. Type a font family name:', this.current?.font ?? '', (name) => name && this.actions.update({ font: name })).open();
				this.render();
			});
			return;
		}
		this.actions.update({ font: v });
	}

	destroy(): void {
		this.el.remove();
	}
}
