// Search scopes (DECISIONS F8): find & replace in a note covers only the text
// the reader sees; comment bodies have their own search in the Comments sidebar.

import type { Range } from './mdScan';
import type { Marker } from './markers';
import type { Thread } from './model';

/**
 * Parts of a note that are in the file but not shown as text: comment markers
 * (with their guards) and the hidden thread block. Sorted, overlaps merged.
 */
export function hiddenRanges(markers: readonly Marker[], block: Range | null): Range[] {
	const all: Range[] = markers.map((m) => ({ from: m.from, to: m.to }));
	if (block && block.to > block.from) all.push({ from: block.from, to: block.to });
	all.sort((a, b) => a.from - b.from);
	const out: Range[] = [];
	for (const r of all) {
		const last = out[out.length - 1];
		if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
		else out.push({ ...r });
	}
	return out;
}

/**
 * Does [from, to) overlap a hidden range? A match that only touches one's edge
 * doesn't; an insertion (from === to) does if it lies strictly inside one.
 * `hidden` must be sorted and non-overlapping (as from hiddenRanges).
 */
export function touchesHidden(hidden: readonly Range[], from: number, to: number): boolean {
	let lo = 0;
	let hi = hidden.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (hidden[mid]!.to <= from) lo = mid + 1;
		else hi = mid;
	}
	const r = hidden[lo];
	// r is the first range ending after `from`; it overlaps if it starts before `to`.
	return !!r && r.from < to;
}

function queryRegex(query: string, flags: string): RegExp {
	return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

/** Ids of a thread's comments whose body contains `query` (plain text, case-insensitive). */
export function matchingComments(thread: Thread, query: string): string[] {
	if (!query) return [];
	const re = queryRegex(query, 'i');
	return thread.comments.filter((c) => re.test(c.body)).map((c) => c.id);
}

/** [start, end) of each occurrence of `query` in `text` (plain text, case-insensitive, non-overlapping). */
export function findOccurrences(text: string, query: string): [number, number][] {
	if (!query) return [];
	const out: [number, number][] = [];
	for (const m of text.matchAll(queryRegex(query, 'gi'))) out.push([m.index, m.index + m[0].length]);
	return out;
}
