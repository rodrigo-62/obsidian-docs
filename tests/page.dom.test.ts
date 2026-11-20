// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installDomHelpers } from './mocks/obsidian';
import { applyPageStyle, clearAllPageStyles, cssFontName } from '../src/obsidian/pageStyle';
import { DocToolbar } from '../src/obsidian/toolbar';
import { readDocSettings, type DocSettings } from '../src/core/docSettings';

beforeAll(installDomHelpers);

const fakeView = () => {
	const contentEl = document.createElement('div');
	contentEl.className = 'view-content';
	contentEl.appendChild(document.createElement('div')).className = 'markdown-source-view';
	return { contentEl } as never as import('obsidian').MarkdownView;
};

describe('page style', () => {
	it('sets classes and variables on the view, not on body', () => {
		const v = fakeView();
		applyPageStyle(v, readDocSettings({ docs: true, 'docs-zoom': 150, 'docs-font-size': 12, 'docs-width': 40, 'docs-font': 'Tinos', 'docs-theme': 'dark' }));
		const el = (v as unknown as { contentEl: HTMLElement }).contentEl;
		expect(el.classList.contains('folio-doc')).toBe(true);
		expect(el.classList.contains('folio-theme-dark')).toBe(true);
		expect(el.style.getPropertyValue('--font-preferred-size')).toBe('24px');
		expect(el.style.getPropertyValue('--folio-page-width')).toBe('960px');
		expect(el.style.getPropertyValue('--font-text')).toBe('"Tinos", var(--font-default)');
		expect(document.body.getAttribute('style')).toBeNull();
		expect(document.body.className).toBe('');
	});

	it('two views can differ, and turning doc mode off cleans up', () => {
		const a = fakeView();
		const b = fakeView();
		applyPageStyle(a, readDocSettings({ docs: true, 'docs-theme': 'light' }));
		applyPageStyle(b, readDocSettings({ docs: true, 'docs-theme': 'dark', 'docs-zoom': 75 }));
		const ea = (a as unknown as { contentEl: HTMLElement }).contentEl;
		const eb = (b as unknown as { contentEl: HTMLElement }).contentEl;
		expect(ea.classList.contains('folio-theme-light')).toBe(true);
		expect(eb.classList.contains('folio-theme-dark')).toBe(true);
		expect(ea.style.getPropertyValue('--font-preferred-size')).not.toBe(eb.style.getPropertyValue('--font-preferred-size'));
		applyPageStyle(a, readDocSettings({ docs: false }));
		expect(ea.className).toBe('view-content');
		expect(ea.style.getPropertyValue('--font-preferred-size')).toBe('');
		clearAllPageStyles();
		expect(eb.className).toBe('view-content');
	});

	it('quotes font names', () => {
		expect(cssFontName('Liberation Serif')).toBe('"Liberation Serif"');
		expect(cssFontName('serif')).toBe('serif');
	});
});

describe('toolbar', () => {
	it('renders values and sends patches', () => {
		const v = fakeView();
		const patches: Partial<DocSettings>[] = [];
		let resolved = false;
		const tb = new DocToolbar({} as never, v, {
			update: (p) => patches.push(p),
			addComment: () => patches.push({ font: 'ADD' }),
			copyForLLM: () => patches.push({ font: 'COPY' }),
			copyOptions: () => undefined,
			toggleResolved: () => (resolved = !resolved),
			showResolved: () => resolved,
			openSidebar: () => undefined,
			commentFontSize: () => 0,
			setCommentFontSize: () => undefined,
		});
		tb.update(readDocSettings({ docs: true, 'docs-zoom': 125, 'docs-font-size': 13, 'docs-theme': 'light' }));
		const el = (v as unknown as { contentEl: HTMLElement }).contentEl;
		expect(el.firstElementChild).toBe(tb.el);
		const zoom = tb.el.querySelector('.folio-tb-zoom') as HTMLSelectElement;
		expect(zoom.value).toBe('125');
		expect(tb.el.querySelector('.folio-tb-size')!.textContent).toBe('13');
		zoom.value = '150';
		zoom.dispatchEvent(new Event('change'));
		(tb.el.querySelector('[aria-label="Increase font size"]') as HTMLElement).click();
		(tb.el.querySelector('[aria-label^="Page theme"]') as HTMLElement).click();
		(tb.el.querySelector('.folio-tb-copy') as HTMLElement).click();
		expect(patches).toEqual([{ zoom: 150 }, { fontSize: 14 }, { theme: 'sepia' }, { font: 'COPY' }]);
		tb.destroy();
		expect(el.querySelector('.folio-toolbar')).toBeNull();
	});
});
