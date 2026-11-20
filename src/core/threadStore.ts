// Read/write the end-of-file thread block (SPEC §5.3):
//
//   <!--folio:threads
//   { ...pretty JSON, one thread per key... }
//   -->
//
// `-->` (and `--!>`) never appear literally inside the block: they are written
// as `--\u003e`, a valid JSON escape that JSON.parse decodes by itself.

import type { Comment, Thread, Threads } from './model';
import { codeAndFrontmatterRanges, inRanges } from './mdScan';

export const BLOCK_OPEN = '<!--folio:threads';
export const BLOCK_CLOSE = '-->';

/** A text change in original-document coordinates. */
export interface Change {
	from: number;
	to: number;
	insert: string;
}

export interface ThreadBlock {
	/** Start of the `<!--folio:threads` line. */
	from: number;
	/** End of the closing `-->`. */
	to: number;
	/** The JSON text between the open and close lines. */
	json: string;
	/** End of the last non-whitespace content before the block (where hiding should start). */
	contentEnd: number;
	/** True if non-whitespace text follows the block (it should be the last thing in the file). */
	trailing: boolean;
}

/** Locate the thread block. If several exist (e.g. a merge), the last one wins. */
export function findThreadBlock(md: string): ThreadBlock | null {
	let idx = md.lastIndexOf(BLOCK_OPEN);
	let code: ReturnType<typeof codeAndFrontmatterRanges> | null = null;
	while (idx !== -1) {
		const atLineStart = idx === 0 || md[idx - 1] === '\n';
		const after = md[idx + BLOCK_OPEN.length];
		const wellFormed = after === '\n' || after === '\r' || after === ' ' || after === undefined;
		if (atLineStart && wellFormed) {
			code ??= codeAndFrontmatterRanges(md);
			if (!inRanges(idx, code)) break;
		}
		idx = idx === 0 ? -1 : md.lastIndexOf(BLOCK_OPEN, idx - 1);
	}
	if (idx === -1) return null;
	const jsonStart = idx + BLOCK_OPEN.length;
	const close = md.indexOf(BLOCK_CLOSE, jsonStart);
	if (close === -1) return null;
	let contentEnd = idx;
	while (contentEnd > 0 && /\s/.test(md[contentEnd - 1] as string)) contentEnd--;
	const to = close + BLOCK_CLOSE.length;
	return {
		from: idx,
		to,
		json: md.slice(jsonStart, close).trim(),
		contentEnd,
		trailing: md.slice(to).trim().length > 0,
	};
}

export type ParseResult =
	| { ok: true; threads: Threads; block: ThreadBlock | null }
	| { ok: false; error: string; block: ThreadBlock };

function asString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function normalizeComment(raw: unknown, i: number): Comment | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const c: Comment = {
		...r,
		id: asString(r.id, 'a' + (i + 1)),
		parent: typeof r.parent === 'string' ? r.parent : null,
		created: asString(r.created),
		body: asString(r.body),
	};
	if (typeof r.edited !== 'string') delete c.edited;
	return c;
}

function normalizeThread(raw: unknown): Thread | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const comments = Array.isArray(r.comments)
		? r.comments.map(normalizeComment).filter((c): c is Comment => c !== null)
		: [];
	const t: Thread = {
		...r,
		quote: asString(r.quote),
		created: asString(r.created, comments[0]?.created ?? ''),
		resolved: r.resolved === true,
		comments,
	};
	if (typeof r.resolvedAt !== 'string') delete t.resolvedAt;
	return t;
}

/** Parse the thread block. A malformed block yields ok:false and must not be overwritten. */
export function parseThreads(md: string): ParseResult {
	const block = findThreadBlock(md);
	if (!block) return { ok: true, threads: {}, block: null };
	let data: unknown;
	try {
		data = block.json === '' ? {} : JSON.parse(block.json);
	} catch (e) {
		return { ok: false, error: `Thread data is not valid JSON: ${(e as Error).message}`, block };
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return { ok: false, error: 'Thread data must be a JSON object', block };
	}
	const threads: Threads = {};
	for (const [id, raw] of Object.entries(data as Record<string, unknown>)) {
		const t = normalizeThread(raw);
		if (t) threads[id] = t;
	}
	return { ok: true, threads, block };
}

const THREAD_KEYS = ['quote', 'created', 'resolved', 'resolvedAt', 'comments'];
const COMMENT_KEYS = ['id', 'parent', 'created', 'edited', 'body'];

function orderedEntries(obj: Record<string, unknown>, known: string[]): [string, unknown][] {
	const out: [string, unknown][] = [];
	for (const k of known) if (obj[k] !== undefined) out.push([k, obj[k]]);
	for (const [k, v] of Object.entries(obj)) if (!known.includes(k) && v !== undefined) out.push([k, v]);
	return out;
}

/** Escape sequences that would end an HTML comment early. */
export function escapeBlockText(s: string): string {
	return s.replace(/--(!?)>/g, '--$1\\u003e');
}

/**
 * Serialise threads into the block body: pretty-printed, one comment per line,
 * so git diffs stay readable.
 */
export function serializeThreadJson(threads: Threads): string {
	const ids = Object.keys(threads);
	if (!ids.length) return '{}';
	const parts = ids.map((id) => {
		const t = threads[id] as Thread;
		const fields = orderedEntries(t as Record<string, unknown>, THREAD_KEYS).map(([k, v]) => {
			if (k === 'comments') {
				const cs = (v as Comment[]).map((c) => {
					const inner = orderedEntries(c as Record<string, unknown>, COMMENT_KEYS)
						.map(([ck, cv]) => `${JSON.stringify(ck)}: ${JSON.stringify(cv)}`)
						.join(', ');
					return `      { ${inner} }`;
				});
				return cs.length ? `    "comments": [\n${cs.join(',\n')}\n    ]` : `    "comments": []`;
			}
			return `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
		});
		return `  ${JSON.stringify(id)}: {\n${fields.join(',\n')}\n  }`;
	});
	return escapeBlockText(`{\n${parts.join(',\n')}\n}`);
}

export function serializeThreadBlock(threads: Threads): string {
	return `${BLOCK_OPEN}\n${serializeThreadJson(threads)}\n${BLOCK_CLOSE}`;
}

/**
 * Changes that make the document's thread block hold `threads`.
 * - no threads: the block (and the blank lines before it) is removed
 * - block exists and is last: it is replaced in place
 * - block is followed by other text: it is moved to the end
 * - no block yet: it is appended after one blank line
 */
export function planThreadWrite(md: string, threads: Threads, existing: ThreadBlock | null = findThreadBlock(md)): Change[] {
	const empty = Object.keys(threads).length === 0;
	if (!existing) {
		if (empty) return [];
		const sep = md.length === 0 ? '' : md.endsWith('\n\n') ? '' : md.endsWith('\n') ? '\n' : '\n\n';
		return [{ from: md.length, to: md.length, insert: `${sep}${serializeThreadBlock(threads)}\n` }];
	}
	if (empty) {
		// Remove from the end of content to the end of the block (keeping one final newline).
		const from = existing.contentEnd;
		let to = existing.to;
		if (md[to] === '\n') to++;
		const keepNl = from > 0 && !existing.trailing ? '\n' : existing.trailing ? '\n\n' : '';
		return [{ from, to, insert: keepNl }];
	}
	const block = serializeThreadBlock(threads);
	if (!existing.trailing) {
		return [{ from: existing.from, to: existing.to, insert: block }];
	}
	// Move the block to the end of the file.
	let removeTo = existing.to;
	while (removeTo < md.length && (md[removeTo] === '\n' || md[removeTo] === '\r')) removeTo++;
	let tailEnd = md.length;
	while (tailEnd > removeTo && /\s/.test(md[tailEnd - 1] as string)) tailEnd--;
	return [
		{ from: existing.from, to: removeTo, insert: '' },
		{ from: tailEnd, to: md.length, insert: `\n\n${block}\n` },
	];
}

/** Apply non-overlapping changes (any order) to a string. */
export function applyChanges(md: string, changes: Change[]): string {
	const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
	let out = '';
	let pos = 0;
	for (const c of sorted) {
		if (c.from < pos) throw new Error('overlapping changes');
		out += md.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return out + md.slice(pos);
}
