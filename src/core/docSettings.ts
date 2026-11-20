// Per-note doc-mode settings from frontmatter (SPEC §3, §4). Pure TypeScript.

export type ThemeChoice = 'light' | 'dark' | 'app';

export interface PageSettings {
	/** Percent, 50–200. */
	zoom: number;
	/** Page (text column) width in em of the zoomed text size. */
	width: number;
	/** CSS font family name; '' = the app's text font. */
	font: string;
	/** Points (like Google Docs). 12 pt = 16 px. */
	fontSize: number;
	theme: ThemeChoice;
}

export interface DocSettings extends PageSettings {
	enabled: boolean;
}

export const DEFAULT_DOC_SETTINGS: PageSettings = {
	zoom: 100,
	width: 42,
	font: '',
	fontSize: 12,
	theme: 'app',
};

export const LIMITS = {
	zoom: { min: 50, max: 200 },
	width: { min: 20, max: 100 },
	fontSize: { min: 6, max: 72 },
} as const;

export const KEYS = {
	enabled: 'folio',
	zoom: 'folio-zoom',
	width: 'folio-width',
	font: 'folio-font',
	fontSize: 'folio-font-size',
	theme: 'folio-theme',
} as const;

/** Zoom presets, as in Google Docs' zoom menu. */
export const ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150, 175, 200];
export const WIDTH_PRESETS = [30, 34, 38, 42, 46, 50, 56, 64, 72];

export function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

function num(v: unknown): number | null {
	if (typeof v === 'number' && isFinite(v)) return v;
	if (typeof v === 'string') {
		const m = /^\s*(-?\d+(?:\.\d+)?)\s*(%|pt|em)?\s*$/.exec(v);
		if (m) return Number(m[1]);
	}
	return null;
}

function bool(v: unknown): boolean {
	if (v === true) return true;
	if (typeof v === 'string') return /^(true|yes|on|1)$/i.test(v.trim());
	return v === 1;
}

/** Read settings from a frontmatter object; missing or invalid keys fall back to `defaults`, numbers are clamped. */
export function readDocSettings(fm: Record<string, unknown> | null | undefined, defaults: PageSettings = DEFAULT_DOC_SETTINGS): DocSettings {
	const f = fm ?? {};
	const zoom = num(f[KEYS.zoom]);
	const width = num(f[KEYS.width]);
	const size = num(f[KEYS.fontSize]);
	const font = typeof f[KEYS.font] === 'string' ? (f[KEYS.font] as string).trim() : '';
	const themeRaw = typeof f[KEYS.theme] === 'string' ? (f[KEYS.theme] as string).trim().toLowerCase() : '';
	const theme: ThemeChoice = themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'app' ? themeRaw : defaults.theme;
	return {
		enabled: bool(f[KEYS.enabled]),
		zoom: Math.round(clamp(zoom ?? defaults.zoom, LIMITS.zoom.min, LIMITS.zoom.max)),
		width: clamp(width ?? defaults.width, LIMITS.width.min, LIMITS.width.max),
		font: font || defaults.font,
		fontSize: clamp(size ?? defaults.fontSize, LIMITS.fontSize.min, LIMITS.fontSize.max),
		theme,
	};
}

/** Next/previous zoom preset from the current value. */
export function stepZoom(current: number, dir: 1 | -1): number {
	if (dir > 0) return ZOOM_STEPS.find((z) => z > current) ?? LIMITS.zoom.max;
	return [...ZOOM_STEPS].reverse().find((z) => z < current) ?? LIMITS.zoom.min;
}

/** Font size steps like Google Docs' −/+ (1 pt below 12, then 2, then 4). */
export function stepFontSize(current: number, dir: 1 | -1): number {
	const step = (v: number) => (v < 12 || (v === 12 && dir < 0) ? 1 : v < 28 || (v === 28 && dir < 0) ? 2 : 4);
	return clamp(current + dir * step(current), LIMITS.fontSize.min, LIMITS.fontSize.max);
}

export interface PageMetrics {
	/** Zoomed text size in px. */
	fontPx: number;
	/** Page width in px (text column, excluding page padding). */
	widthPx: number;
}

/** Zoom scales the font size; the page width is in em of that size, so both scale together. */
export function pageMetrics(s: PageSettings): PageMetrics {
	const fontPx = (s.fontSize * 4) / 3 * (s.zoom / 100);
	return { fontPx: Math.round(fontPx * 100) / 100, widthPx: Math.round(s.width * fontPx) };
}

/** Frontmatter values to write for a change (only the changed keys). */
export function toFrontmatter(patch: Partial<DocSettings>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (patch.enabled !== undefined) out[KEYS.enabled] = patch.enabled;
	if (patch.zoom !== undefined) out[KEYS.zoom] = patch.zoom;
	if (patch.width !== undefined) out[KEYS.width] = patch.width;
	if (patch.font !== undefined) out[KEYS.font] = patch.font;
	if (patch.fontSize !== undefined) out[KEYS.fontSize] = patch.fontSize;
	if (patch.theme !== undefined) out[KEYS.theme] = patch.theme;
	return out;
}
