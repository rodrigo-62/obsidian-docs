import { App, PluginSettingTab, Setting } from 'obsidian';
import type FolioPlugin from './main';
import { DEFAULT_DOC_SETTINGS, type ThemeChoice } from '../core/docSettings';

export interface FolioSettings {
	// Page defaults (used when a note's frontmatter key is missing)
	defaultZoom: number;
	defaultWidth: number;
	defaultFont: string;
	defaultFontSize: number;
	defaultTheme: ThemeChoice;
	// Comments
	marginWidth: number;
	defaultThreadView: 'flat' | 'tree';
	showResolved: boolean;
	// Copy for LLM
	exportIncludeResolved: boolean;
	exportEmbeds: 'inline' | 'reference';
	exportIncludePrivate: boolean;
	// UI
	showHeaderButtons: boolean;
	ctrlAltScrollZoom: boolean;
}

export const DEFAULT_SETTINGS: FolioSettings = {
	defaultZoom: DEFAULT_DOC_SETTINGS.zoom,
	defaultWidth: DEFAULT_DOC_SETTINGS.width,
	defaultFont: DEFAULT_DOC_SETTINGS.font,
	defaultFontSize: DEFAULT_DOC_SETTINGS.fontSize,
	defaultTheme: DEFAULT_DOC_SETTINGS.theme,
	marginWidth: 300,
	defaultThreadView: 'flat',
	showResolved: false,
	exportIncludeResolved: false,
	exportEmbeds: 'inline',
	exportIncludePrivate: false,
	showHeaderButtons: true,
	ctrlAltScrollZoom: true,
};

export class FolioSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolioPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
		};

		new Setting(containerEl).setName('Page defaults').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Used in doc mode when a note does not set its own value. A note stores its own values in folio-* frontmatter keys (written by the toolbar).',
		});
		new Setting(containerEl)
			.setName('Zoom (%)')
			.addSlider((sl) =>
				sl
					.setLimits(50, 200, 5)
					.setValue(s.defaultZoom)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.defaultZoom = v;
						await save();
					}),
			);
		new Setting(containerEl)
			.setName('Page width (em)')
			.setDesc('Width of the text column. Scales with zoom and font size.')
			.addSlider((sl) =>
				sl
					.setLimits(20, 100, 1)
					.setValue(s.defaultWidth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.defaultWidth = v;
						await save();
					}),
			);
		new Setting(containerEl)
			.setName('Font')
			.setDesc('Empty means the app’s text font.')
			.addText((t) =>
				t
					.setPlaceholder('e.g. Liberation Serif')
					.setValue(s.defaultFont)
					.onChange(async (v) => {
						s.defaultFont = v.trim();
						await save();
					}),
			);
		new Setting(containerEl)
			.setName('Font size (pt)')
			.setDesc('12 pt = 16 px, the Obsidian default.')
			.addSlider((sl) =>
				sl
					.setLimits(8, 32, 1)
					.setValue(s.defaultFontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.defaultFontSize = v;
						await save();
					}),
			);
		new Setting(containerEl).setName('Page theme').addDropdown((d) =>
			d
				.addOptions({ app: 'Follow the app', light: 'Paper light', dark: 'Paper dark' })
				.setValue(s.defaultTheme)
				.onChange(async (v) => {
					s.defaultTheme = v as ThemeChoice;
					await save();
				}),
		);
		new Setting(containerEl)
			.setName('Ctrl+Alt+scroll zooms')
			.setDesc('In doc mode, hold Ctrl+Alt and scroll to change this note’s zoom.')
			.addToggle((t) =>
				t.setValue(s.ctrlAltScrollZoom).onChange(async (v) => {
					s.ctrlAltScrollZoom = v;
					await save();
				}),
			);

		new Setting(containerEl).setName('Comments').setHeading();
		new Setting(containerEl)
			.setName('Margin width (px)')
			.setDesc('Width of the comment column. If the pane is too narrow for page plus margin, comments move to the sidebar.')
			.addSlider((sl) =>
				sl
					.setLimits(220, 480, 10)
					.setValue(s.marginWidth)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.marginWidth = v;
						await save();
					}),
			);
		new Setting(containerEl)
			.setName('Thread display')
			.setDesc('Flat shows replies in time order with “↳ re:” chips; tree indents replies under the comment they answer. Each thread can be switched individually.')
			.addDropdown((d) =>
				d
					.addOptions({ flat: 'Flat (time order)', tree: 'Tree' })
					.setValue(s.defaultThreadView)
					.onChange(async (v) => {
						s.defaultThreadView = v as 'flat' | 'tree';
						await save();
					}),
			);
		new Setting(containerEl).setName('Show resolved comments').addToggle((t) =>
			t.setValue(s.showResolved).onChange(async (v) => {
				s.showResolved = v;
				await save();
			}),
		);

		new Setting(containerEl).setName('Copy for LLM').setHeading();
		new Setting(containerEl).setName('Include resolved threads').addToggle((t) =>
			t.setValue(s.exportIncludeResolved).onChange(async (v) => {
				s.exportIncludeResolved = v;
				await save();
			}),
		);
		new Setting(containerEl)
			.setName('Embedded notes')
			.addDropdown((d) =>
				d
					.addOptions({ inline: 'Inline their content', reference: 'Reference only' })
					.setValue(s.exportEmbeds)
					.onChange(async (v) => {
						s.exportEmbeds = v as 'inline' | 'reference';
						await save();
					}),
			);
		new Setting(containerEl).setName('Include %% private %% comments').addToggle((t) =>
			t.setValue(s.exportIncludePrivate).onChange(async (v) => {
				s.exportIncludePrivate = v;
				await save();
			}),
		);

		new Setting(containerEl).setName('Interface').setHeading();
		new Setting(containerEl)
			.setName('Header buttons')
			.setDesc('Show “Copy for LLM” and “Add comment” buttons in every note’s header.')
			.addToggle((t) =>
				t.setValue(s.showHeaderButtons).onChange(async (v) => {
					s.showHeaderButtons = v;
					await save();
					this.plugin.refreshAllViews();
				}),
			);
	}
}
