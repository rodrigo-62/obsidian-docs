// Per-view page appearance (SPEC §4). Everything is set as classes and CSS
// custom properties on the view's own content element — never on <body> — so
// two panes can look different and the rest of the app is untouched.

import type { MarkdownView } from 'obsidian';
import { pageMetrics, type DocSettings } from '../core/docSettings';

const CLASSES = ['folio-doc', 'folio-theme-light', 'folio-theme-dark'];
const VARS = ['--folio-font-px', '--folio-page-width', '--folio-page-pad-x', '--folio-page-pad-y', '--font-preferred-size', '--file-line-width', '--font-text', '--folio-zoom'];

const styled = new Set<HTMLElement>();

export function applyPageStyle(view: MarkdownView, s: DocSettings | null): void {
	const el = view.contentEl;
	if (!s || !s.enabled) {
		clearPageStyle(el);
		return;
	}
	const m = pageMetrics(s);
	el.addClass('folio-doc');
	el.toggleClass('folio-theme-light', s.theme === 'light');
	el.toggleClass('folio-theme-dark', s.theme === 'dark');
	el.style.setProperty('--folio-zoom', String(s.zoom / 100));
	el.style.setProperty('--folio-font-px', `${m.fontPx}px`);
	el.style.setProperty('--folio-page-width', `${m.widthPx}px`);
	el.style.setProperty('--folio-page-pad-x', `${Math.round(m.fontPx * 3.5)}px`);
	el.style.setProperty('--folio-page-pad-y', `${Math.round(m.fontPx * 3)}px`);
	// Obsidian resolves --font-preferred-size on <body>; it must be overridden directly (docs/RESEARCH.md).
	el.style.setProperty('--font-preferred-size', `${m.fontPx}px`);
	el.style.setProperty('--file-line-width', `${m.widthPx}px`);
	if (s.font) el.style.setProperty('--font-text', `${cssFontName(s.font)}, var(--font-default)`);
	else el.style.removeProperty('--font-text');
	styled.add(el);
}

export function clearPageStyle(el: HTMLElement): void {
	if (!styled.has(el) && !el.hasClass('folio-doc')) return;
	el.removeClass(...CLASSES);
	for (const v of VARS) el.style.removeProperty(v);
	styled.delete(el);
}

export function clearAllPageStyles(): void {
	for (const el of [...styled]) clearPageStyle(el);
}

/** Quote a font family name for CSS. */
export function cssFontName(name: string): string {
	return /^[a-z-]+$/i.test(name) && ['serif', 'sans-serif', 'monospace', 'cursive', 'system-ui'].includes(name) ? name : `"${name.replace(/["\\]/g, '')}"`;
}
