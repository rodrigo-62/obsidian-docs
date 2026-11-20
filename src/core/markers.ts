// Anchor markers: <!--c:ID-->commented text<!--/c:ID--> (SPEC §5.3, DECISIONS D0.2).
//
// A marker that starts a (non-heading) line's text is preceded by a zero-width
// space "guard" (U+200B); otherwise CommonMark would treat the whole line as a
// raw HTML block. The guard belongs to the marker: it is hidden, removed and
// stripped together with it.

import {
	codeAndFrontmatterRanges,
	inRanges,
	inlineCodeRanges,
	fencedCodeRanges,
	frontmatterRange,
	lineEndAt,
	lineMarkup,
	lineStartAt,
	mergeRanges,
	rangeAt,
	type Range,
} from './mdScan';
import { findThreadBlock, type Change, type ThreadBlock } from './threadStore';

export const GUARD = '\u200b';
/** Matches one marker, with its optional guard. Group 1: "/" for an end marker. Group 2: the id. */
export const MARKER_SOURCE = '\\u200b?<!--(\\/?)c:([A-Za-z0-9]+)-->';
export const markerRegex = (): RegExp => new RegExp(MARKER_SOURCE, 'g');

export const openMarker = (id: string): string => `<!--c:${id}-->`;
export const closeMarker = (id: string): string => `<!--/c:${id}-->`;

export interface Marker {
	id: string;
	kind: 'open' | 'close';
	/** Start, including the guard if present. */
	from: number;
	to: number;
	guard: boolean;
}

export interface Anchor {
	id: string;
	open: Marker;
	close: Marker;
	/** The commented text lies in [textFrom, textTo) (it may contain other markers). */
	textFrom: number;
	textTo: number;
}

export interface MarkerParse {
	/** Every recognised marker outside code/frontmatter/thread block, in document order. */
	markers: Marker[];
	/** Well-formed pairs: the first start marker of an id and the first end marker after it. */
	anchors: Map<string, Anchor>;
	/** Markers that are not part of a well-formed pair (lone, reversed or duplicated). */
	stray: Marker[];
	/** Regions where markers are ignored (code, frontmatter, thread block). */
	ignored: Range[];
	threadBlock: ThreadBlock | null;
}

/** Regions in which markers are not recognised. */
export function ignoredRanges(md: string, block: ThreadBlock | null = findThreadBlock(md)): Range[] {
	const end = block ? block.from : md.length;
	const ranges = codeAndFrontmatterRanges(md, end);
	if (block) ranges.push({ from: block.from, to: md.length });
	return mergeRanges(ranges);
}

export function parseMarkers(md: string, block: ThreadBlock | null = findThreadBlock(md)): MarkerParse {
	const ignored = ignoredRanges(md, block);
	const markers: Marker[] = [];
	const re = markerRegex();
	let m: RegExpExecArray | null;
	while ((m = re.exec(md))) {
		const guard = md.charCodeAt(m.index) === 0x200b;
		const start = guard ? m.index + 1 : m.index;
		if (inRanges(start, ignored)) {
			const r = rangeAt(start, ignored);
			if (r) re.lastIndex = Math.max(re.lastIndex, r.to);
			continue;
		}
		markers.push({
			id: m[2] as string,
			kind: m[1] === '/' ? 'close' : 'open',
			from: m.index,
			to: m.index + m[0].length,
			guard,
		});
	}
	const anchors = new Map<string, Anchor>();
	const used = new Set<Marker>();
	const firstOpen = new Map<string, Marker>();
	for (const mk of markers) if (mk.kind === 'open' && !firstOpen.has(mk.id)) firstOpen.set(mk.id, mk);
	for (const [id, open] of firstOpen) {
		const close = markers.find((mk) => mk.kind === 'close' && mk.id === id && mk.from >= open.to);
		if (!close) continue;
		anchors.set(id, { id, open, close, textFrom: open.to, textTo: close.from });
		used.add(open);
		used.add(close);
	}
	const stray = markers.filter((mk) => !used.has(mk));
	return { markers, anchors, stray, ignored, threadBlock: block };
}

/** Text between the markers, with any nested markers stripped. */
export function anchorText(md: string, anchor: Anchor): string {
	return stripMarkers(md.slice(anchor.textFrom, anchor.textTo));
}

/** Remove every marker (and its guard) from a piece of text. */
export function stripMarkers(text: string): string {
	return text.replace(markerRegex(), '');
}

/** Random base-36 id, unique among `existing`. */
export function generateId(existing: Iterable<string>, random: () => number = Math.random, length = 4): string {
	const taken = new Set(existing);
	for (let attempt = 0; attempt < 1000; attempt++) {
		const len = length + Math.floor(attempt / 50);
		let id = '';
		for (let i = 0; i < len; i++) id += Math.floor(random() * 36).toString(36);
		// Start with a letter so ids never look like numbers.
		if (!/^[a-z]/.test(id)) id = String.fromCharCode(97 + Math.floor(random() * 26)) + id.slice(1);
		if (!taken.has(id)) return id;
	}
	throw new Error('could not generate a unique id');
}

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

export type InsertionPlan =
	| { ok: true; changes: Change[]; from: number; to: number; textFrom: number; textTo: number; quote: string }
	| { ok: false; error: string };

/**
 * Plan where the two markers of a new comment go for a selection [from, to).
 * Adjusts the range so that it never starts inside block markup (bullets,
 * `>`, `#`), never ends at the start of a line, never splits a marker or an
 * inline code span, and refuses ranges that touch fenced code or frontmatter.
 * The returned textFrom/textTo are the commented text range *after* applying the changes.
 */
export function planAnchorInsertion(md: string, selFrom: number, selTo: number, id: string, parse: MarkerParse = parseMarkers(md)): InsertionPlan {
	let from = Math.min(selFrom, selTo);
	let to = Math.max(selFrom, selTo);
	const contentEnd = parse.threadBlock ? parse.threadBlock.contentEnd : md.length;
	from = Math.max(0, Math.min(from, contentEnd));
	to = Math.max(0, Math.min(to, contentEnd));

	// Snap out of markers so they are never split.
	for (const mk of parse.markers) {
		if (from > mk.from && from < mk.to) from = mk.to;
		if (to > mk.from && to < mk.to) to = mk.from;
	}

	const trim = () => {
		for (;;) {
			const before = `${from}:${to}`;
			while (from < to && isSpace(md[from])) from++;
			while (to > from && isSpace(md[to - 1])) to--;
			// Skip markers sitting at the edges of the selection: the new range
			// starts after (and ends before) them, so a guard stays first on its line.
			for (const mk of parse.markers) {
				if (mk.from === from && mk.to <= to) from = mk.to;
				if (mk.to === to && mk.from >= from) to = mk.from;
			}
			if (`${from}:${to}` === before) return;
		}
	};
	trim();
	if (from >= to) return { ok: false, error: 'Select some text to comment on.' };

	const fm = frontmatterRange(md);
	if (fm && from < fm.to) return { ok: false, error: "Comments can't be added to the frontmatter." };
	const fenced = fencedCodeRanges(md, fm ? fm.to : 0, contentEnd);
	if (fenced.some((r) => from < r.to && to > r.from && !(from <= r.from && to >= r.to))) {
		return { ok: false, error: "A comment can't start or end inside a code block." };
	}
	for (const r of inlineCodeRanges(md, mergeRanges([...(fm ? [fm] : []), ...fenced]), 0, contentEnd)) {
		if (from > r.from && from < r.to) from = r.from;
		if (to > r.from && to < r.to) to = r.to;
	}

	// Start: never inside a line's block markup.
	const fromLine = lineStartAt(md, from);
	const fromMarkup = lineMarkup(md.slice(fromLine, lineEndAt(md, from)));
	if (from < fromLine + fromMarkup.textStart) from = fromLine + fromMarkup.textStart;
	// End: never inside the next line's markup (move back to the previous line's end).
	let toLine = lineStartAt(md, to);
	while (to > from && to <= toLine + lineMarkup(md.slice(toLine, lineEndAt(md, to))).textStart && toLine > from) {
		to = toLine - 1;
		while (to > from && isSpace(md[to - 1])) to--;
		toLine = lineStartAt(md, to);
	}
	trim();
	if (from >= to) return { ok: false, error: 'Select some text to comment on.' };

	// A marker at the start of a non-heading line's text needs a guard. If
	// markers already start the line (from > textStart), the first carries it.
	const lineStart = lineStartAt(md, from);
	const markup = lineMarkup(md.slice(lineStart, lineEndAt(md, from)));
	const guard = !markup.heading && from === lineStart + markup.textStart;
	const openAt = from;
	const open = (guard ? GUARD : '') + openMarker(id);
	const close = closeMarker(id);
	const quote = stripMarkers(md.slice(from, to));
	const changes: Change[] = [
		{ from: openAt, to: openAt, insert: open },
		{ from: to, to, insert: close },
	];
	return {
		ok: true,
		changes,
		from,
		to,
		textFrom: openAt + open.length,
		textTo: to + open.length,
		quote,
	};
}

/** Changes removing a marker; its guard is kept if another marker directly follows (that one still needs it). */
export function markerRemoval(md: string, mk: Marker): Change {
	if (mk.guard && /^\u200b?<!--\/?c:[A-Za-z0-9]+-->/.test(md.slice(mk.to, mk.to + 40))) {
		return { from: mk.from + 1, to: mk.to, insert: '' };
	}
	return { from: mk.from, to: mk.to, insert: '' };
}

/** Changes removing every marker of the given ids (anchors and strays). */
export function planAnchorRemoval(md: string, ids: Iterable<string>, parse: MarkerParse = parseMarkers(md)): Change[] {
	const set = new Set(ids);
	return parse.markers.filter((mk) => set.has(mk.id)).map((mk) => markerRemoval(md, mk));
}

/**
 * Changes that repair marker damage:
 * - stray markers (lone, reversed, duplicated) are removed;
 * - anchors whose id has no thread are removed;
 * - anchors with no text left between their markers are removed (their thread becomes detached).
 * Only call with a successfully parsed thread set.
 */
export function planRepair(md: string, threadIds: ReadonlySet<string>, parse: MarkerParse = parseMarkers(md)): Change[] {
	const remove = new Set<Marker>(parse.stray);
	for (const a of parse.anchors.values()) {
		if (!threadIds.has(a.id) || anchorText(md, a).trim() === '') {
			remove.add(a.open);
			remove.add(a.close);
		}
	}
	return [...remove].sort((a, b) => a.from - b.from).map((mk) => markerRemoval(md, mk));
}

/** Ids of threads that have no well-formed anchor (shown as "Detached comments"). */
export function detachedIds(threadIds: Iterable<string>, parse: MarkerParse): string[] {
	return [...threadIds].filter((id) => !parse.anchors.has(id));
}

// ---------------------------------------------------------------------------
// Pure helpers for live editing (used by the CodeMirror transaction filter).
// ---------------------------------------------------------------------------

/** Number of anchors that an insertion at `pos` would land inside. */
function depthAt(pos: number, anchors: Iterable<Anchor>): number {
	let d = 0;
	for (const a of anchors) if (a.textFrom <= pos && pos <= a.textTo) d++;
	return d;
}

/**
 * Where a typed insertion at `pos` should really go. Text typed at the visual
 * edge of a commented range goes *outside* it (as in Google Docs): among the
 * positions in the run of adjacent markers around `pos`, pick the one inside
 * the fewest ranges, preferring the one closest to `pos`.
 */
export function adjustInsertionPos(pos: number, parse: Pick<MarkerParse, 'markers' | 'anchors'>): number {
	const ms = parse.markers;
	// Find the contiguous run of markers touching pos.
	let i = ms.findIndex((mk) => mk.to >= pos);
	if (i === -1) return pos;
	const touching = (mk: Marker) => mk.from <= pos && pos <= mk.to;
	if (!touching(ms[i] as Marker)) return pos;
	let lo = i;
	while (lo > 0 && (ms[lo - 1] as Marker).to === (ms[lo] as Marker).from) lo--;
	let hi = i;
	while (hi < ms.length - 1 && (ms[hi + 1] as Marker).from === (ms[hi] as Marker).to) hi++;
	const candidates = [(ms[lo] as Marker).from, ...ms.slice(lo, hi + 1).map((mk) => mk.to)];
	const anchors = [...parse.anchors.values()];
	let best = pos;
	let bestDepth = Infinity;
	let bestDist = Infinity;
	for (const c of candidates) {
		const d = depthAt(c, anchors);
		const dist = Math.abs(c - pos);
		if (d < bestDepth || (d === bestDepth && dist < bestDist)) {
			best = c;
			bestDepth = d;
			bestDist = dist;
		}
	}
	return best;
}

export interface DeletionResult {
	/** The ranges to actually delete (sorted, non-overlapping). */
	ranges: Range[];
	/** Ids whose anchor is entirely removed by this edit (both markers deleted or no text left). */
	orphaned: string[];
}

/**
 * Adjust deletions so marker pairs stay consistent:
 * - a marker whose partner survives is protected (the deletion is split around it);
 * - a marker is deleted only together with its partner;
 * - a deletion that would only hit protected markers (e.g. Backspace right after
 *   a hidden marker) is moved past them by one character in `direction`;
 * - a pair left with no text between its markers is removed (its thread is detached).
 */
export function adjustDeletions(
	md: string,
	deletions: Range[],
	parse: Pick<MarkerParse, 'markers' | 'anchors'>,
	direction: 'backward' | 'forward' | null = null,
): DeletionResult {
	const dels = mergeRanges(deletions);
	if (!dels.length) return { ranges: [], orphaned: [] };
	const covered = (mk: Marker) => dels.some((d) => d.from <= mk.from && mk.to <= d.to);
	const overlaps = (mk: Marker) => dels.some((d) => d.from < mk.to && mk.from < d.to);
	const partnerOf = new Map<Marker, Marker | null>();
	for (const a of parse.anchors.values()) {
		partnerOf.set(a.open, a.close);
		partnerOf.set(a.close, a.open);
	}
	const removable = new Set<Marker>();
	const protectedMs: Marker[] = [];
	for (const mk of parse.markers) {
		if (!overlaps(mk)) continue;
		const partner = partnerOf.get(mk) ?? null;
		// Stray markers may go freely; paired ones only together with their partner.
		if (partner === null || (overlaps(partner) && (covered(mk) || covered(partner)))) removable.add(mk);
		else protectedMs.push(mk);
	}
	// Expand deletions to swallow removable markers they only partly cover.
	let ranges = dels.map((d) => ({ ...d }));
	for (const mk of removable) {
		for (const d of ranges) {
			if (d.from < mk.to && mk.from < d.to) {
				d.from = Math.min(d.from, mk.from);
				d.to = Math.max(d.to, mk.to);
			}
		}
	}
	ranges = mergeRanges(ranges);
	// Cut protected markers out of the deletions.
	for (const mk of protectedMs) {
		const next: Range[] = [];
		for (const d of ranges) {
			if (d.to <= mk.from || d.from >= mk.to) next.push(d);
			else {
				if (d.from < mk.from) next.push({ from: d.from, to: mk.from });
				if (d.to > mk.to) next.push({ from: mk.to, to: d.to });
			}
		}
		ranges = next;
	}
	ranges = mergeRanges(ranges);

	// Deletion only hit hidden markers: step over them by one character.
	if (!ranges.length && direction && protectedMs.length) {
		const first = dels[0] as Range;
		const last = dels[dels.length - 1] as Range;
		const sorted = [...parse.markers].sort((a, b) => a.from - b.from);
		if (direction === 'backward') {
			let p = first.from;
			// walk left over adjacent markers
			for (let k = sorted.length - 1; k >= 0; k--) {
				const mk = sorted[k] as Marker;
				if (mk.to === p || (mk.from < p && mk.to >= p)) p = mk.from;
			}
			if (p > 0) {
				const size = p >= 2 && /[\uDC00-\uDFFF]/.test(md[p - 1] as string) ? 2 : 1;
				ranges = [{ from: p - size, to: p }];
			}
		} else {
			let p = last.to;
			for (const mk of sorted) if (mk.from === p || (mk.from <= p && mk.to > p)) p = mk.to;
			if (p < md.length) {
				const size = /[\uD800-\uDBFF]/.test(md[p] as string) ? 2 : 1;
				ranges = [{ from: p, to: p + size }];
			}
		}
	}

	// Pairs whose markers are both deleted, or that have no text left, become orphans.
	const deleted = (pos: number, end: number) => ranges.some((d) => d.from <= pos && end <= d.to);
	const orphaned: string[] = [];
	const extra: Range[] = [];
	for (const a of parse.anchors.values()) {
		const openGone = deleted(a.open.from, a.open.to);
		const closeGone = deleted(a.close.from, a.close.to);
		if (openGone && closeGone) {
			orphaned.push(a.id);
			continue;
		}
		if (openGone || closeGone) continue;
		// Is any visible text left between the markers?
		const touched = ranges.some((d) => d.from < a.textTo && a.textFrom < d.to);
		if (!touched) continue;
		let visible = 0;
		let pos = a.textFrom;
		const inner = parse.markers.filter((mk) => mk.from >= a.textFrom && mk.to <= a.textTo);
		while (pos < a.textTo) {
			const d = ranges.find((r) => r.from <= pos && pos < r.to);
			if (d) {
				pos = d.to;
				continue;
			}
			const mk = inner.find((x) => x.from <= pos && pos < x.to);
			if (mk) {
				pos = mk.to;
				continue;
			}
			if (!/\s/.test(md[pos] as string)) visible++;
			pos++;
			if (visible) break;
		}
		if (!visible) {
			orphaned.push(a.id);
			extra.push({ from: a.open.from, to: a.open.to }, { from: a.close.from, to: a.close.to });
		}
	}
	return { ranges: mergeRanges([...ranges, ...extra]), orphaned };
}

/**
 * For pasted text: strip markers that would be meaningless or duplicates.
 * A pasted pair is kept only if its id has a thread here and that thread has
 * no anchor yet (pasting restores a detached comment). Everything else is
 * stripped, so ids stay unique.
 */
export function sanitizePastedMarkers(text: string, threadIds: ReadonlySet<string>, anchoredIds: ReadonlySet<string>): string {
	const re = markerRegex();
	const counts = new Map<string, { open: number; close: number }>();
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const c = counts.get(m[2] as string) ?? { open: 0, close: 0 };
		if (m[1] === '/') c.close++;
		else c.open++;
		counts.set(m[2] as string, c);
	}
	return text.replace(markerRegex(), (full, slash: string, id: string) => {
		const c = counts.get(id);
		const keep = threadIds.has(id) && !anchoredIds.has(id) && c && c.open === 1 && c.close === 1;
		return keep ? full : '';
	});
}
