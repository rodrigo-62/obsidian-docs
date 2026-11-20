// Adjustable "paper" page themes (light, sepia, dark). Pure TypeScript.
//
// Obsidian's colours are built from a grey scale --color-base-00 … -100. A
// theme is defined by four numbers; the whole scale is remapped linearly
// between the chosen page and text lightness, so secondary greys (borders,
// muted text, code backgrounds) stay consistent with the choice. Warmth adds
// a sepia hue.

export type PaperKind = 'light' | 'sepia' | 'dark';

export interface ThemeTweak {
	/** Page background lightness, 0–100. */
	page: number;
	/** Text lightness, 0–100. */
	text: number;
	/** How much darker the area around the page is, in lightness points. */
	surround: number;
	/** Sepia warmth, 0–100. */
	warmth: number;
}

export const DEFAULT_TWEAKS: Record<PaperKind, ThemeTweak> = {
	light: { page: 100, text: 13, surround: 12, warmth: 0 },
	sepia: { page: 95, text: 17, surround: 14, warmth: 60 },
	dark: { page: 12, text: 87, surround: 6, warmth: 0 },
};

export const TWEAK_LIMITS: Record<PaperKind, Record<keyof ThemeTweak, [number, number]>> = {
	light: { page: [80, 100], text: [0, 45], surround: [0, 30], warmth: [0, 100] },
	sepia: { page: [75, 100], text: [0, 45], surround: [0, 30], warmth: [0, 100] },
	dark: { page: [0, 30], text: [55, 100], surround: [0, 15], warmth: [0, 100] },
};

// Lightness of Obsidian's default grey scale (from app.css), per theme.
const LIGHT_LEVELS: Record<string, number> = { '00': 100, '05': 98.8, '10': 98, '20': 96.5, '25': 93.7, '30': 89.4, '35': 85.5, '40': 74, '50': 67, '60': 44, '70': 36, '100': 13.3 };
const DARK_LEVELS: Record<string, number> = { '00': 11, '05': 12.9, '10': 13.7, '20': 15.7, '25': 18, '30': 20, '35': 24.7, '40': 33.3, '50': 40, '60': 60, '70': 70, '100': 85.5 };

const HUE = 38;
const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hsl(l: number, sat: number): string {
	return `hsl(${HUE} ${round(sat)}% ${round(clamp(l, 0, 100))}%)`;
}

export function clampTweak(kind: PaperKind, t: Partial<ThemeTweak> | undefined): ThemeTweak {
	const d = DEFAULT_TWEAKS[kind];
	const lim = TWEAK_LIMITS[kind];
	const v = (k: keyof ThemeTweak) => {
		const x = t?.[k];
		return typeof x === 'number' && isFinite(x) ? clamp(x, lim[k][0], lim[k][1]) : d[k];
	};
	return { page: v('page'), text: v('text'), surround: v('surround'), warmth: v('warmth') };
}

/** CSS custom properties for a paper theme (set inline on the page container). */
export function paperVars(kind: PaperKind, tweak: ThemeTweak): Record<string, string> {
	const t = clampTweak(kind, tweak);
	const levels = kind === 'dark' ? DARK_LEVELS : LIGHT_LEVELS;
	const L00 = levels['00']!;
	const L100 = levels['100']!;
	const map = (l: number) => t.text + ((l - L100) * (t.page - t.text)) / (L00 - L100);
	const pageSat = (t.warmth / 100) * (kind === 'dark' ? 18 : 42);
	const textSat = pageSat * 0.6;
	const out: Record<string, string> = {};
	for (const [k, l] of Object.entries(levels)) {
		const ml = map(l);
		// levels close to the page get the page's tint, levels close to the text the text's
		const w = Math.abs(ml - t.page) / Math.max(1, Math.abs(t.text - t.page));
		out[`--color-base-${k}`] = hsl(ml, pageSat * (1 - w) + textSat * w);
	}
	const surround = kind === 'dark' ? (t.page - t.surround >= 0 ? t.page - t.surround : t.page + t.surround) : t.page - t.surround;
	out['--folio-surround'] = hsl(surround, pageSat);
	out['--folio-page-border'] = hsl(kind === 'dark' ? t.page + 12 : t.page - 20, pageSat);
	return out;
}
