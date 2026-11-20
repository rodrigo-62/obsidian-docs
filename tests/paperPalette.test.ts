import { describe, expect, it } from 'vitest';
import { DEFAULT_TWEAKS, clampTweak, paperVars } from '../src/core/paperPalette';

const L = (hsl: string) => Number(/ ([\d.]+)%\)$/.exec(hsl)![1]);
const S = (hsl: string) => Number(/ ([\d.]+)% [\d.]+%\)$/.exec(hsl)![1]);

describe('paper palettes', () => {
	it('maps the grey scale between page and text lightness', () => {
		const v = paperVars('light', DEFAULT_TWEAKS.light);
		expect(L(v['--color-base-00']!)).toBe(100);
		expect(L(v['--color-base-100']!)).toBe(13);
		expect(L(v['--color-base-30']!)).toBeLessThan(L(v['--color-base-20']!));
		expect(S(v['--color-base-00']!)).toBe(0);
	});

	it('makes the light surround clearly darker than the page', () => {
		const v = paperVars('light', DEFAULT_TWEAKS.light);
		expect(L(v['--folio-surround']!)).toBe(88);
	});

	it('sepia is warm, dark is dark', () => {
		const s = paperVars('sepia', DEFAULT_TWEAKS.sepia);
		expect(S(s['--color-base-00']!)).toBeGreaterThan(20);
		const d = paperVars('dark', DEFAULT_TWEAKS.dark);
		expect(L(d['--color-base-00']!)).toBe(12);
		expect(L(d['--color-base-100']!)).toBe(87);
		expect(L(d['--folio-surround']!)).toBe(6);
	});

	it('a black (AMOLED) dark page gets a surround that is still distinguishable', () => {
		const d = paperVars('dark', { page: 0, text: 90, surround: 6, warmth: 0 });
		expect(L(d['--folio-surround']!)).toBe(6);
	});

	it('clamps out-of-range and missing values', () => {
		expect(clampTweak('dark', { page: 90 })).toEqual({ ...DEFAULT_TWEAKS.dark, page: 30 });
		expect(clampTweak('light', undefined)).toEqual(DEFAULT_TWEAKS.light);
	});
});
