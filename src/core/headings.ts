// Heading navigation (next/previous heading). Pure TypeScript.
import { codeAndFrontmatterRanges, inRanges } from './mdScan';
import { findThreadBlock } from './threadStore';

export interface HeadingPos {
	/** Start of the heading line. */
	line: number;
	/** Start of the heading's text (after the #s). */
	text: number;
	level: number;
}

export function headings(md: string): HeadingPos[] {
	const b = findThreadBlock(md);
	const end = b ? b.contentEnd : md.length;
	const code = codeAndFrontmatterRanges(md, end);
	const out: HeadingPos[] = [];
	const re = /^(#{1,6})[ \t]+/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		out.push({ line: m.index, text: m.index + m[0].length, level: (m[1] as string).length });
	}
	return out;
}

/** The heading after (dir 1) or before (dir -1) the line containing `pos`; null at the ends. */
export function adjacentHeading(md: string, pos: number, dir: 1 | -1): HeadingPos | null {
	const lineStart = md.lastIndexOf('\n', pos - 1) + 1;
	const hs = headings(md);
	if (dir > 0) return hs.find((h) => h.line > lineStart) ?? null;
	for (let i = hs.length - 1; i >= 0; i--) if (hs[i]!.line < lineStart) return hs[i]!;
	return null;
}
