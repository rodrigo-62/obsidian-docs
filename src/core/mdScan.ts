// Lightweight Markdown scanning helpers shared by markers, threadStore and export.
// Pure TypeScript: no Obsidian or CodeMirror imports.

export interface Range {
	from: number;
	to: number;
}

/** Offsets of every line start in `md` (always includes 0). */
export function lineStarts(md: string): number[] {
	const starts = [0];
	for (let i = md.indexOf('\n'); i !== -1; i = md.indexOf('\n', i + 1)) starts.push(i + 1);
	return starts;
}

export function lineStartAt(md: string, pos: number): number {
	return md.lastIndexOf('\n', pos - 1) + 1;
}

export function lineEndAt(md: string, pos: number): number {
	const i = md.indexOf('\n', pos);
	return i === -1 ? md.length : i;
}

/** YAML frontmatter at the very start of the file, including its closing line break. */
export function frontmatterRange(md: string): Range | null {
	const m = /^---[ \t]*\r?\n/.exec(md);
	if (!m) return null;
	const re = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
	re.lastIndex = m[0].length;
	const end = re.exec(md);
	if (!end) return null;
	return { from: 0, to: end.index + end[0].length };
}

const FENCE_OPEN = /^([ \t>]*)(`{3,}|~{3,})([^\n]*)$/;

/**
 * Fenced code blocks (``` or ~~~), including inside blockquotes or list items.
 * Ranges cover the whole block from the opening fence line to the end of the
 * closing fence line; an unclosed fence runs to `end`.
 */
export function fencedCodeRanges(md: string, start = 0, end = md.length): Range[] {
	const out: Range[] = [];
	let pos = start;
	let open: { from: number; char: string; len: number } | null = null;
	while (pos < end) {
		const nl = md.indexOf('\n', pos);
		const lineEnd = nl === -1 || nl > end ? end : nl;
		const line = md.slice(pos, lineEnd).replace(/\r$/, '');
		if (!open) {
			const m = FENCE_OPEN.exec(line);
			if (m && m[1] !== undefined && m[2] !== undefined) {
				const fence = m[2];
				const info = m[3] ?? '';
				// A backtick fence's info string may not contain backticks.
				if (!(fence[0] === '`' && info.includes('`'))) {
					open = { from: pos, char: fence[0] as string, len: fence.length };
				}
			}
		} else {
			const t = line.replace(/^[ \t>]*/, '');
			const m = /^(`{3,}|~{3,})[ \t]*$/.exec(t);
			if (m && m[1] && m[1][0] === open.char && m[1].length >= open.len) {
				out.push({ from: open.from, to: Math.min(lineEnd + 1, end) });
				open = null;
			}
		}
		pos = lineEnd + 1;
	}
	if (open) out.push({ from: open.from, to: end });
	return out;
}

/**
 * Inline code spans (`code`, ``code``) outside the given excluded ranges.
 * A span may not cross a blank line.
 */
export function inlineCodeRanges(md: string, excluded: Range[] = [], start = 0, end = md.length): Range[] {
	const out: Range[] = [];
	const re = /`+/g;
	re.lastIndex = start;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md)) && m.index < end) {
		if (inRanges(m.index, excluded)) {
			const r = rangeAt(m.index, excluded);
			re.lastIndex = r ? r.to : m.index + m[0].length;
			continue;
		}
		const ticks = m[0];
		const openEnd = m.index + ticks.length;
		// find the closing run of exactly the same length
		const close = new RegExp('(?<!`)' + ticks + '(?!`)', 'g');
		close.lastIndex = openEnd;
		const c = close.exec(md);
		if (!c || c.index >= end) continue;
		const between = md.slice(openEnd, c.index);
		if (/\n[ \t]*\r?\n/.test(between)) continue; // spans can't cross a blank line
		if (excluded.some((r) => r.from < c.index && r.to > openEnd)) continue;
		out.push({ from: m.index, to: c.index + ticks.length });
		re.lastIndex = c.index + ticks.length;
	}
	return out;
}

/** Sorted, merged union of ranges. */
export function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
	const out: Range[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
		else out.push({ ...r });
	}
	return out;
}

/** Binary search: the range in sorted, non-overlapping `ranges` containing pos (from <= pos < to). */
export function rangeAt(pos: number, ranges: Range[]): Range | null {
	let lo = 0;
	let hi = ranges.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const r = ranges[mid] as Range;
		if (pos < r.from) hi = mid - 1;
		else if (pos >= r.to) lo = mid + 1;
		else return r;
	}
	return null;
}

export function inRanges(pos: number, ranges: Range[]): boolean {
	return rangeAt(pos, ranges) !== null;
}

/** All code regions (fenced + inline) plus frontmatter, merged and sorted. */
export function codeAndFrontmatterRanges(md: string, end = md.length): Range[] {
	const fm = frontmatterRange(md);
	const fenced = fencedCodeRanges(md, fm ? fm.to : 0, end);
	const base = mergeRanges([...(fm ? [fm] : []), ...fenced]);
	const inline = inlineCodeRanges(md, base, fm ? fm.to : 0, end);
	return mergeRanges([...base, ...inline]);
}

export interface LineMarkup {
	/** Offset within the line where its text starts (after indentation, quotes, bullets, task boxes, headings, callouts, footnote labels). */
	textStart: number;
	heading: boolean;
}

const QUOTE = /^[ \t]*>[ \t]?/;
const LIST_ITEM = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+(?:\[[^\]\n]\](?:[ \t]+|$))?|$)/;
const HEADING = /^[ \t]*#{1,6}(?:[ \t]+|$)/;
const CALLOUT = /^\[![^\]\n]*\][-+]?(?:[ \t]+|$)/;
const FOOTNOTE_DEF = /^\[\^[^\]\n]+\]:(?:[ \t]+|$)/;
const INDENT = /^[ \t]*/;

/** Where a line's own text begins, past any block markup. */
export function lineMarkup(line: string): LineMarkup {
	let end = 0;
	let innermostQuote = false;
	for (;;) {
		const rest = line.slice(end);
		const q = QUOTE.exec(rest);
		const piece = q ?? LIST_ITEM.exec(rest);
		if (!piece || piece[0].length === 0) break;
		end += piece[0].length;
		innermostQuote = !!q;
	}
	let rest = line.slice(end);
	const h = HEADING.exec(rest);
	if (h) return { textStart: end + h[0].length, heading: true };
	if (innermostQuote) {
		const c = CALLOUT.exec(rest);
		if (c) {
			end += c[0].length;
			rest = line.slice(end);
		}
	}
	const f = FOOTNOTE_DEF.exec(rest);
	if (f) {
		end += f[0].length;
		rest = line.slice(end);
	}
	const ind = INDENT.exec(rest);
	if (ind) end += ind[0].length;
	return { textStart: end, heading: false };
}
