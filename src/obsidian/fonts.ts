// Font list for the toolbar's picker, and installed-font detection.
//
// document.fonts.check() reports true for fonts that simply aren't installed
// (nothing to load), so detection measures text instead: if a string renders
// with the same width as with the generic fallbacks, the font is missing.

export const CURATED_FONTS = [
	// serif
	'Liberation Serif',
	'Tinos',
	'Times New Roman',
	'Georgia',
	'EB Garamond',
	'Crimson Pro',
	'Libre Baskerville',
	'Source Serif 4',
	'Literata',
	'Merriweather',
	'Charter',
	'Noto Serif',
	'DejaVu Serif',
	// sans
	'Liberation Sans',
	'Arimo',
	'Arial',
	'Inter',
	'Noto Sans',
	'Open Sans',
	'Roboto',
	'Source Sans 3',
	'DejaVu Sans',
	// mono
	'Courier Prime',
	'JetBrains Mono',
	'Liberation Mono',
];

/** Metric-compatible free alternatives, shown as a hint when a font is missing. */
export const FONT_ALTERNATIVES: Record<string, string> = {
	'Times New Roman': 'Liberation Serif or Tinos',
	Arial: 'Liberation Sans or Arimo',
	'Courier New': 'Liberation Mono or Cousine',
	Georgia: 'Gelasio',
};

const cache = new Map<string, boolean>();
let ctx: CanvasRenderingContext2D | null = null;

export function isFontInstalled(name: string): boolean {
	if (!name) return true;
	const hit = cache.get(name);
	if (hit !== undefined) return hit;
	ctx ??= createEl('canvas').getContext('2d');
	if (!ctx) return true;
	const sample = 'mmmmmmmmmmlliiWW@#0123456789 The quick brown fox';
	let installed = false;
	for (const fallback of ['monospace', 'serif', 'sans-serif']) {
		ctx.font = `48px ${fallback}`;
		const base = ctx.measureText(sample).width;
		ctx.font = `48px "${name.replace(/"/g, '')}", ${fallback}`;
		if (ctx.measureText(sample).width !== base) {
			installed = true;
			break;
		}
	}
	cache.set(name, installed);
	return installed;
}

/** System fonts via the Local Font Access API, if Electron allows it (else null). */
export async function querySystemFonts(): Promise<string[] | null> {
	const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
	if (!q) return null;
	try {
		const fonts = await q();
		return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
	} catch {
		return null;
	}
}
