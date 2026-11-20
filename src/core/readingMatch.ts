// Locating commented text in Reading view (SPEC §9 phase 6). Obsidian's
// renderer drops HTML comments, so the markers are gone in the rendered HTML.
// We find the anchored text by comparing "signatures": the letters and digits
// of the source and of the rendered text, lower-cased, ignoring all markup and
// punctuation differences. Pure TypeScript.

import { stripMarkers } from './markers';

export interface Signature {
	sig: string;
	/** map[i] = index in the original text of sig[i] */
	map: number[];
}

const WORD = /[\p{L}\p{N}]/u;

export function signature(text: string): Signature {
	let sig = '';
	const map: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string;
		// surrogate pairs: keep both halves together
		const code = text.codePointAt(i)!;
		const full = code > 0xffff ? text.slice(i, i + 2) : ch;
		if (WORD.test(full)) {
			sig += full.toLowerCase();
			for (let k = 0; k < full.length; k++) map.push(i + k);
		}
		if (full.length === 2) i++;
	}
	return { sig, map };
}

/** Remove Markdown syntax that doesn't show up as text when rendered. */
export function renderedTextOf(markdown: string): string {
	return stripMarkers(markdown)
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/%%[\s\S]*?%%/g, '')
		.replace(/\[\^[^\]]+\]/g, '') // footnote refs (rendered as numbers elsewhere)
		.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
		.replace(/!?\[\[([^\]]*)\]\]/g, (_, l: string) => l.replace(/#\^?/g, ' '))
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
		.replace(/^\s*\[[ xX\-/]\]\s+/gm, '');
}

/**
 * Find `needle` (source Markdown of the commented text) in `rendered` text.
 * `occurrence` picks the n-th match (0-based), for text that appears more than
 * once in a section. Returns [start, end) offsets into `rendered`, or null.
 */
export function findRendered(rendered: string, needleMarkdown: string, occurrence = 0): [number, number] | null {
	const n = signature(renderedTextOf(needleMarkdown)).sig;
	if (!n) return null;
	const hay = signature(rendered);
	let at = -1;
	let from = 0;
	for (let k = 0; k <= occurrence; k++) {
		at = hay.sig.indexOf(n, from);
		if (at === -1) return occurrence > 0 ? findRendered(rendered, needleMarkdown, 0) : null;
		from = at + 1;
	}
	const start = hay.map[at]!;
	const end = hay.map[at + n.length - 1]! + 1;
	return [start, end];
}

/** How many times the anchor's text occurs in `before` (source text of the section before the anchor). */
export function occurrenceIndex(before: string, needleMarkdown: string): number {
	const n = signature(renderedTextOf(needleMarkdown)).sig;
	if (!n) return 0;
	const hay = signature(renderedTextOf(before)).sig;
	let count = 0;
	for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + 1)) count++;
	return count;
}
