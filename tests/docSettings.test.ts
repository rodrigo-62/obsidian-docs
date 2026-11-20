import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_SETTINGS, pageMetrics, readDocSettings, stepFontSize, stepZoom, toFrontmatter } from '../src/core/docSettings';

describe('docSettings', () => {
	it('reads the spec example', () => {
		expect(
			readDocSettings({ folio: true, 'folio-zoom': 100, 'folio-width': 42, 'folio-font': 'Times New Roman', 'folio-font-size': 15, 'folio-theme': 'light' }),
		).toEqual({ enabled: true, zoom: 100, width: 42, font: 'Times New Roman', fontSize: 15, theme: 'light' });
	});

	it('falls back to defaults for missing or invalid keys', () => {
		expect(readDocSettings(undefined)).toEqual({ enabled: false, ...DEFAULT_DOC_SETTINGS });
		expect(readDocSettings({ folio: 'yes', 'folio-zoom': 'abc', 'folio-theme': 'purple' })).toMatchObject({ enabled: true, zoom: 100, theme: 'app' });
		const d = { ...DEFAULT_DOC_SETTINGS, zoom: 125, font: 'Tinos' };
		expect(readDocSettings({}, d)).toMatchObject({ zoom: 125, font: 'Tinos' });
	});

	it('accepts strings with units and clamps', () => {
		expect(readDocSettings({ 'folio-zoom': '150%', 'folio-font-size': '14pt', 'folio-width': '30em' })).toMatchObject({ zoom: 150, fontSize: 14, width: 30 });
		expect(readDocSettings({ 'folio-zoom': 1000, 'folio-width': 1, 'folio-font-size': 0 })).toMatchObject({ zoom: 200, width: 20, fontSize: 6 });
	});

	it('steps zoom through presets', () => {
		expect(stepZoom(100, 1)).toBe(110);
		expect(stepZoom(100, -1)).toBe(90);
		expect(stepZoom(105, 1)).toBe(110);
		expect(stepZoom(200, 1)).toBe(200);
		expect(stepZoom(50, -1)).toBe(50);
	});

	it('steps font size like Google Docs', () => {
		expect(stepFontSize(11, 1)).toBe(12);
		expect(stepFontSize(12, 1)).toBe(14);
		expect(stepFontSize(12, -1)).toBe(11);
		expect(stepFontSize(28, 1)).toBe(32);
		expect(stepFontSize(6, -1)).toBe(6);
	});

	it('computes page metrics: width scales with zoom and font size', () => {
		expect(pageMetrics({ ...DEFAULT_DOC_SETTINGS, fontSize: 12, zoom: 100, width: 42 })).toEqual({ fontPx: 16, widthPx: 672 });
		expect(pageMetrics({ ...DEFAULT_DOC_SETTINGS, fontSize: 12, zoom: 150, width: 42 })).toEqual({ fontPx: 24, widthPx: 1008 });
		expect(pageMetrics({ ...DEFAULT_DOC_SETTINGS, fontSize: 15, zoom: 100, width: 42 }).fontPx).toBe(20);
	});

	it('maps patches to frontmatter keys', () => {
		expect(toFrontmatter({ zoom: 125, theme: 'dark' })).toEqual({ 'folio-zoom': 125, 'folio-theme': 'dark' });
	});
});
