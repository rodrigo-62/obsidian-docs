// "Copy for LLM" (SPEC §6): turn a note into text an AI agent can fully
// understand, with everything that is only visual in Obsidian spelled out.
// Pure TypeScript: embedded notes are passed in through `resolveEmbed`.

import { codeAndFrontmatterRanges, fencedCodeRanges, frontmatterRange, inlineCodeRanges, inRanges, mergeRanges, type Range } from './mdScan';
import { parseMarkers, type Anchor, type Marker } from './markers';
import { commentsInTimeOrder, type Thread, type Threads } from './model';
import { findThreadBlock } from './threadStore';

export type ExportMode = 'full' | 'comments' | 'text';

export interface ExportOptions {
	/** Used as <document title="…">, normally the file's basename. */
	title?: string;
	/** full (default): text + threads; comments: threads only; text: text only. */
	mode?: ExportMode;
	/** Include resolved threads (default false). */
	includeResolved?: boolean;
	/** Only this range of the markdown, and only threads that intersect it. */
	selection?: { from: number; to: number } | null;
	/** inline (default): put embedded notes' content in <embed> blocks; reference: leave a reference. */
	embeds?: 'inline' | 'reference';
	/** Full markdown of an embedded note (link target without subpath), or null if not found. */
	resolveEmbed?: (target: string) => string | null;
	/** Include Obsidian %% private %% comments (default false). */
	includePrivate?: boolean;
	/** Date formatting for comments (default: UTC "YYYY-MM-DD HH:mm"). */
	formatDate?: (iso: string) => string;
}

export interface ExportStats {
	words: number;
	threads: number;
	resolvedOmitted: number;
	detached: number;
}

export interface ExportResult {
	text: string;
	stats: ExportStats;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|tiff?)$/i;

export function defaultFormatDate(iso: string): string {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
	if (!m) return iso;
	const d = new Date(iso);
	if (isNaN(d.getTime())) return `${m[1]} ${m[2]}`;
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeBody(s: string): string {
	return s.replace(/<\/(comment|thread|comments|anchor)/gi, '<\\/$1');
}

// ---------------------------------------------------------------------------
// Span collection
// ---------------------------------------------------------------------------

type Span =
	| { kind: 'code'; from: number; to: number }
	| { kind: 'marker'; from: number; to: number; marker: Marker }
	| { kind: 'private'; from: number; to: number; inner: Range }
	| { kind: 'fndef'; from: number; to: number; label: string; inner: Range }
	| { kind: 'fninline'; from: number; to: number; inner: Range }
	| { kind: 'fnref'; from: number; to: number; label: string }
	| { kind: 'embed'; from: number; to: number; target: string; subpath: string; alias: string }
	| { kind: 'mdimage'; from: number; to: number; alt: string; url: string };

/** Footnote definitions: `[^label]: text` plus indented continuation lines. */
function footnoteDefs(md: string, start: number, end: number, code: Range[]): Span[] {
	const out: Span[] = [];
	const re = /^\[\^([^\]\n]+)\]:[ \t]?/gm;
	re.lastIndex = start;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		const innerFrom = m.index + m[0].length;
		let lineEnd = md.indexOf('\n', innerFrom);
		if (lineEnd === -1 || lineEnd > end) lineEnd = end;
		let to = lineEnd;
		// continuation: following lines indented by a tab or 2+ spaces, possibly after blank lines
		let pos = lineEnd + 1;
		while (pos < end) {
			let nl = md.indexOf('\n', pos);
			if (nl === -1 || nl > end) nl = end;
			const line = md.slice(pos, nl);
			if (/^(\t| {2,})\S/.test(line)) {
				to = nl;
				pos = nl + 1;
				continue;
			}
			if (line.trim() === '') {
				// a blank line continues the definition only if an indented line follows
				let look = nl + 1;
				while (look < end) {
					let n2 = md.indexOf('\n', look);
					if (n2 === -1 || n2 > end) n2 = end;
					const l2 = md.slice(look, n2);
					if (l2.trim() === '') {
						look = n2 + 1;
						continue;
					}
					if (/^(\t| {2,})\S/.test(l2)) pos = look;
					break;
				}
				if (pos !== look) break;
				continue;
			}
			break;
		}
		const lineEndIncl = to < end && md[to] === '\n' ? to + 1 : to;
		out.push({ kind: 'fndef', from: m.index, to: lineEndIncl, label: m[1] as string, inner: { from: innerFrom, to } });
		re.lastIndex = lineEndIncl;
	}
	return out;
}

/** Footnote references [^label] (not definitions). */
function footnoteRefs(md: string, start: number, end: number, code: Range[]): Span[] {
	const out: Span[] = [];
	const re = /\[\^([^\]\n]+)\]/g;
	re.lastIndex = start;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		const atLineStart = m.index === 0 || md[m.index - 1] === '\n';
		if (atLineStart && md[m.index + m[0].length] === ':') continue; // a definition
		out.push({ kind: 'fnref', from: m.index, to: m.index + m[0].length, label: m[1] as string });
	}
	return out;
}

/** Inline footnotes ^[text], with balanced brackets. */
function inlineFootnotes(md: string, start: number, end: number, code: Range[]): Span[] {
	const out: Span[] = [];
	let i = md.indexOf('^[', start);
	while (i !== -1 && i < end) {
		if (inRanges(i, code)) {
			i = md.indexOf('^[', i + 2);
			continue;
		}
		let depth = 0;
		let j = i + 1;
		for (; j < end; j++) {
			const ch = md[j];
			if (ch === '[') depth++;
			else if (ch === ']') {
				depth--;
				if (depth === 0) break;
			} else if (ch === '\n' && md[j + 1] === '\n') break;
		}
		if (j < end && md[j] === ']' && depth === 0) {
			out.push({ kind: 'fninline', from: i, to: j + 1, inner: { from: i + 2, to: j } });
			i = md.indexOf('^[', j + 1);
		} else i = md.indexOf('^[', i + 2);
	}
	return out;
}

function privateComments(md: string, start: number, end: number, code: Range[]): Span[] {
	const out: Span[] = [];
	let i = md.indexOf('%%', start);
	while (i !== -1 && i < end) {
		if (inRanges(i, code)) {
			i = md.indexOf('%%', i + 2);
			continue;
		}
		let j = md.indexOf('%%', i + 2);
		while (j !== -1 && inRanges(j, code)) j = md.indexOf('%%', j + 2);
		if (j === -1 || j + 2 > end) break; // unclosed: leave as text
		out.push({ kind: 'private', from: i, to: j + 2, inner: { from: i + 2, to: j } });
		i = md.indexOf('%%', j + 2);
	}
	return out;
}

function embeds(md: string, start: number, end: number, code: Range[]): Span[] {
	const out: Span[] = [];
	const wiki = /!\[\[([^\]\n]+)\]\]/g;
	wiki.lastIndex = start;
	let m: RegExpExecArray | null;
	while ((m = wiki.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		const raw = m[1] as string;
		const bar = raw.indexOf('|');
		const link = bar === -1 ? raw : raw.slice(0, bar);
		const alias = bar === -1 ? '' : raw.slice(bar + 1);
		const hash = link.indexOf('#');
		const target = (hash === -1 ? link : link.slice(0, hash)).trim();
		const subpath = hash === -1 ? '' : link.slice(hash);
		out.push({ kind: 'embed', from: m.index, to: m.index + m[0].length, target, subpath, alias: alias.trim() });
	}
	const img = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g;
	img.lastIndex = start;
	while ((m = img.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		const url = (m[2] as string).trim().replace(/^<|>$/g, '').replace(/\s+"[^"]*"$/, '');
		out.push({ kind: 'mdimage', from: m.index, to: m.index + m[0].length, alt: (m[1] as string).trim(), url });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Embeds
// ---------------------------------------------------------------------------

/** Link targets of all note embeds (not images), so the caller can load them first. */
export function findEmbedTargets(md: string): string[] {
	const code = codeAndFrontmatterRanges(md);
	const set = new Set<string>();
	for (const s of embeds(md, 0, md.length, code)) {
		if (s.kind === 'embed' && s.target && !IMAGE_EXT.test(s.target) && !/\.(pdf|mp3|wav|m4a|ogg|mp4|webm|mov)$/i.test(s.target)) set.add(s.target);
	}
	return [...set];
}

/** The part of a note an embed subpath points to (#Heading, #A#B, #^block). */
export function extractSection(md: string, subpath: string): string | null {
	if (!subpath) return md;
	const parts = subpath.split('#').filter(Boolean);
	const last = parts[parts.length - 1] ?? '';
	const lines = md.split('\n');
	if (last.startsWith('^')) {
		const id = last.slice(1);
		const idx = lines.findIndex((l) => new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l));
		if (idx === -1) return null;
		let a = idx;
		while (a > 0 && (lines[a - 1] as string).trim() !== '') a--;
		return lines
			.slice(a, idx + 1)
			.join('\n')
			.replace(/\s\^[\w-]+\s*$/, '');
	}
	const norm = (s: string) => s.replace(/<!--\/?c:[A-Za-z0-9]+-->|​/g, '').replace(/[\s#]+$/, '').trim().toLowerCase();
	const want = norm(last);
	let start = -1;
	let level = 0;
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i] as string;
		if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
		if (inFence) continue;
		const h = /^(#{1,6})\s+(.*)$/.exec(l);
		if (!h) continue;
		if (start === -1) {
			if (norm(h[2] as string) === want) {
				start = i;
				level = (h[1] as string).length;
			}
		} else if ((h[1] as string).length <= level) {
			return lines.slice(start, i).join('\n').replace(/\s+$/, '');
		}
	}
	return start === -1 ? null : lines.slice(start).join('\n').replace(/\s+$/, '');
}

/** Clean an embedded note: no frontmatter, thread block, comment markers or (by default) private comments; nested embeds become references. */
function cleanEmbedded(md: string, includePrivate: boolean): string {
	const block = findThreadBlock(md);
	const end = block ? block.contentEnd : md.length;
	const fm = frontmatterRange(md);
	const start = fm ? fm.to : 0;
	const code = codeAndFrontmatterRanges(md, end);
	const parse = parseMarkers(md, block);
	const spans: Span[] = [
		...parse.markers.map((mk): Span => ({ kind: 'marker', from: mk.from, to: mk.to, marker: mk })),
		...(includePrivate ? [] : privateComments(md, start, end, code)),
		...embeds(md, start, end, code),
	].sort((a, b) => a.from - b.from);
	let out = '';
	let pos = start;
	for (const s of spans) {
		if (s.from < pos) continue;
		out += md.slice(pos, s.from);
		if (s.kind === 'embed') out += embedReference(s);
		else if (s.kind === 'mdimage') out += imageText(s.url, s.alt);
		pos = s.to;
	}
	out += md.slice(pos, end);
	return out.replace(/^\s*\n/, '').replace(/\s+$/, '');
}

function basename(path: string): string {
	return path.split('/').pop() ?? path;
}

function imageText(file: string, alt: string): string {
	const a = alt && !/^\d+(x\d+)?$/.test(alt) ? ` — ${alt}` : '';
	return `[image: ${/^[a-z][a-z0-9+.-]*:\/\//i.test(file) ? file : basename(file)}${a}]`;
}

function embedReference(s: Extract<Span, { kind: 'embed' }>): string {
	if (IMAGE_EXT.test(s.target)) return imageText(s.target, s.alias);
	if (/\.[a-z0-9]{2,4}$/i.test(s.target) && !/\.md$/i.test(s.target)) return `[embedded file: ${basename(s.target)}]`;
	return `[embed: ${s.target}${s.subpath}]`;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** Frontmatter with the plugin's own `folio`/`folio-*` keys removed; '' if nothing remains. */
export function cleanFrontmatter(raw: string): string {
	const lines = raw.replace(/\r/g, '').split('\n');
	const closeIdx = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
	const inner = lines.slice(1, closeIdx > 0 ? closeIdx : lines.length);
	const kept: string[] = [];
	let skipping = false;
	for (const l of inner) {
		if (/^[^\s#-][^:]*:/.test(l) || /^"[^"]*":/.test(l)) {
			const key = l.slice(0, l.indexOf(':')).replace(/^"|"$/g, '').trim();
			skipping = key === 'folio' || key.startsWith('folio-');
		}
		if (!skipping) kept.push(l);
	}
	if (!kept.some((l) => l.trim() !== '')) return '';
	return `---\n${kept.join('\n')}\n---\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Numbered {
	id: string;
	n: number;
	thread: Thread;
	anchor: Anchor | null;
}

export function exportForLLM(markdown: string, threads: Threads, options: ExportOptions = {}): ExportResult {
	const md = markdown.replace(/\r\n/g, '\n');
	const mode = options.mode ?? 'full';
	const includeResolved = options.includeResolved ?? false;
	const embedMode = options.embeds ?? 'inline';
	const includePrivate = options.includePrivate ?? false;
	const formatDate = options.formatDate ?? defaultFormatDate;
	const title = options.title ?? 'Untitled';

	const block = findThreadBlock(md);
	const contentEnd = block ? block.contentEnd : md.length;
	const fm = frontmatterRange(md);
	const bodyStart = fm ? fm.to : 0;
	const fenced = fencedCodeRanges(md, bodyStart, contentEnd);
	const code = mergeRanges([...fenced, ...inlineCodeRanges(md, fenced, bodyStart, contentEnd)]);
	const parse = parseMarkers(md, block);

	let selFrom = bodyStart;
	let selTo = contentEnd;
	const sel = options.selection ?? null;
	if (sel) {
		selFrom = Math.max(bodyStart, Math.min(sel.from, sel.to));
		selTo = Math.min(contentEnd, Math.max(sel.from, sel.to));
	}

	// --- Which threads, numbered in reading order -------------------------
	const anchoredIds = [...parse.anchors.values()].filter((a) => threads[a.id]).sort((a, b) => a.open.from - b.open.from);
	const inScope = (a: Anchor) => !sel || (a.textFrom < selTo && a.textTo > selFrom) || (a.textFrom === a.textTo && a.textFrom >= selFrom && a.textFrom <= selTo);
	let resolvedOmitted = 0;
	const numbered: Numbered[] = [];
	const byId = new Map<string, Numbered>();
	for (const a of anchoredIds) {
		if (!inScope(a)) continue;
		const t = threads[a.id] as Thread;
		if (t.resolved && !includeResolved) {
			resolvedOmitted++;
			continue;
		}
		const nb = { id: a.id, n: numbered.length + 1, thread: t, anchor: a };
		numbered.push(nb);
		byId.set(a.id, nb);
	}
	let detachedCount = 0;
	if (!sel) {
		const detached = Object.keys(threads)
			.filter((id) => !parse.anchors.has(id))
			.sort((a, b) => ((threads[a]?.created ?? '') < (threads[b]?.created ?? '') ? -1 : 1));
		for (const id of detached) {
			const t = threads[id] as Thread;
			if (t.resolved && !includeResolved) {
				resolvedOmitted++;
				continue;
			}
			numbered.push({ id, n: numbered.length + 1, thread: t, anchor: null });
			detachedCount++;
		}
	}
	const showMilestones = mode === 'full';

	// --- Spans ------------------------------------------------------------
	const spans: Span[] = [
		...code.map((r): Span => ({ kind: 'code', from: r.from, to: r.to })),
		...parse.markers.filter((mk) => mk.from >= bodyStart && mk.to <= contentEnd).map((mk): Span => ({ kind: 'marker', from: mk.from, to: mk.to, marker: mk })),
		...privateComments(md, bodyStart, contentEnd, code),
		...footnoteDefs(md, bodyStart, contentEnd, code),
		...inlineFootnotes(md, bodyStart, contentEnd, code),
		...footnoteRefs(md, bodyStart, contentEnd, code),
		...embeds(md, bodyStart, contentEnd, code),
	].sort((a, b) => a.from - b.from || b.to - a.to);

	// Footnote labels: numeric labels and inline footnotes are renumbered 1..n in
	// order of first reference (as Obsidian displays them); named labels are kept.
	const isNumeric = (l: string) => /^\d+$/.test(l);
	const relabel = new Map<string, string>();
	const inlineLabel = new Map<number, string>();
	const namedLabels = new Set(spans.filter((x): x is Extract<Span, { kind: 'fndef' | 'fnref' }> => (x.kind === 'fndef' || x.kind === 'fnref') && !isNumeric(x.label)).map((x) => x.label));
	let nextNumber = 1;
	const allocate = () => {
		while (namedLabels.has(String(nextNumber))) nextNumber++;
		return String(nextNumber++);
	};
	for (const x of spans) {
		if (x.kind === 'fnref' && isNumeric(x.label) && !relabel.has(x.label)) relabel.set(x.label, allocate());
		else if (x.kind === 'fninline') inlineLabel.set(x.from, allocate());
	}
	for (const x of spans) if (x.kind === 'fndef' && isNumeric(x.label) && !relabel.has(x.label)) relabel.set(x.label, allocate());
	const mapLabel = (l: string) => relabel.get(l) ?? l;

	const flags = { milestones: false, footnotes: false, embeds: false, images: false, private: false };
	const footnoteText = new Map<string, string>();
	const inlineNotes: { label: string; text: string; at: number }[] = [];

	const milestone = (mk: Marker): string => {
		if (!showMilestones) return '';
		const nb = byId.get(mk.id);
		if (!nb || !nb.anchor || (nb.anchor.open !== mk && nb.anchor.close !== mk)) return '';
		flags.milestones = true;
		return mk.kind === 'open' ? `⟦c${nb.n}⟧` : `⟦/c${nb.n}⟧`;
	};

	/** Only the milestones inside a range whose text is dropped. */
	const milestonesIn = (from: number, to: number): string =>
		spans
			.filter((s): s is Extract<Span, { kind: 'marker' }> => s.kind === 'marker' && s.from >= from && s.to <= to)
			.map((s) => milestone(s.marker))
			.join('');

	const emit = (from: number, to: number): string => {
		let out = '';
		let pos = from;
		for (const s of spans) {
			if (s.from < pos || s.from < from) continue;
			if (s.from >= to) break;
			if (s.to > to) continue; // crosses the boundary of the current container
			out += md.slice(pos, s.from);
			switch (s.kind) {
				case 'code':
					out += md.slice(s.from, s.to);
					break;
				case 'marker':
					out += milestone(s.marker);
					break;
				case 'private':
					if (includePrivate) {
						flags.private = true;
						out += '%%' + emit(s.inner.from, s.inner.to) + '%%';
					} else out += milestonesIn(s.from, s.to);
					break;
				case 'fndef':
					footnoteText.set(mapLabel(s.label), emit(s.inner.from, s.inner.to).replace(/\n(\t| {2,4})/g, '\n    ').trim());
					break;
				case 'fnref':
					out += `[^${mapLabel(s.label)}]`;
					break;
				case 'fninline': {
					const label = inlineLabel.get(s.from) ?? allocate();
					inlineNotes.push({ label, text: emit(s.inner.from, s.inner.to).trim(), at: s.from });
					out += `[^${label}]`;
					break;
				}
				case 'embed':
					out += renderEmbed(s);
					break;
				case 'mdimage':
					flags.images = true;
					out += imageText(s.url, s.alt);
					break;
			}
			pos = s.to;
		}
		return out + md.slice(pos, to);
	};

	const renderEmbed = (s: Extract<Span, { kind: 'embed' }>): string => {
		const ref = embedReference(s);
		if (ref.startsWith('[image:')) {
			flags.images = true;
			return ref;
		}
		if (ref.startsWith('[embedded file:')) return ref;
		flags.embeds = true;
		if (embedMode === 'reference' || !options.resolveEmbed) return ref;
		const full = options.resolveEmbed(s.target);
		if (full === null) return `[embed: ${s.target}${s.subpath} (not found)]`;
		const section = extractSection(full.replace(/\r\n/g, '\n'), s.subpath);
		if (section === null) return `[embed: ${s.target}${s.subpath} (section not found)]`;
		const content = cleanEmbedded(section, includePrivate);
		return `<embed source="${escapeAttr(s.target + s.subpath)}">\n${content}\n</embed>`;
	};

	// --- Document text ----------------------------------------------------
	let docText = '';
	if (mode !== 'comments') {
		// footnote definitions anywhere in the note are collected even when exporting a selection
		let prefix = '';
		let suffix = '';
		if (sel && showMilestones) {
			for (const nb of numbered) {
				const a = nb.anchor;
				if (!a) continue;
				if (a.open.from < selFrom && a.textTo > selFrom) prefix += `⟦c${nb.n}⟧`;
				if (a.close.to > selTo && a.textFrom < selTo) suffix = `⟦/c${nb.n}⟧` + suffix;
			}
			if (prefix || suffix) flags.milestones = true;
		}
		const fmText = fm && !sel ? cleanFrontmatter(md.slice(fm.from, fm.to)) : '';
		docText = fmText + prefix + emit(selFrom, selTo) + suffix;
		if (sel) {
			// definitions outside the selection, for references inside it
			for (const s of spans) if (s.kind === 'fndef' && (s.from < selFrom || s.from >= selTo)) footnoteText.set(mapLabel(s.label), emit(s.inner.from, s.inner.to).trim());
		}
		docText = docText.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
	}

	// --- Footnotes in order of first reference ------------------------------
	const footnoteLines: string[] = [];
	if (mode !== 'comments') {
		const refs: string[] = [];
		const refRe = /\[\^([^\]\n]+)\](?!:)/g;
		let m: RegExpExecArray | null;
		while ((m = refRe.exec(docText))) if (!refs.includes(m[1] as string)) refs.push(m[1] as string);
		const inlineMap = new Map(inlineNotes.map((n) => [n.label, n.text]));
		const all = new Map<string, string>([...footnoteText, ...inlineMap]);
		const order = [...refs.filter((r) => all.has(r)), ...(sel ? [] : [...all.keys()].filter((k) => !refs.includes(k)))];
		for (const label of order) footnoteLines.push(`[^${label}]: ${all.get(label)}`);
		if (footnoteLines.length) flags.footnotes = true;
	}

	// --- Comments section -------------------------------------------------
	const commentLines: string[] = [];
	if (mode !== 'text' && numbered.length) {
		for (const nb of numbered) {
			const t = nb.thread;
			const anchorTextRaw = nb.anchor ? md.slice(nb.anchor.textFrom, nb.anchor.textTo) : t.quote;
			const anchorPlain = nb.anchor ? stripAll(anchorTextRaw) : t.quote;
			const attrs = [`id="c${nb.n}"`, `status="${t.resolved ? 'resolved' : 'open'}"`];
			if (!nb.anchor) attrs.push('detached="true"');
			const multiline = anchorPlain.includes('\n');
			if (!multiline) attrs.push(`anchor="${escapeAttr(anchorPlain)}"`);
			commentLines.push(`<thread ${attrs.join(' ')}>`);
			if (multiline) commentLines.push(`  <anchor>${escapeBody(anchorPlain)}</anchor>`);
			const ordered = commentsInTimeOrder(t);
			const index = new Map(ordered.map((c, i) => [c.id, i + 1]));
			ordered.forEach((c, i) => {
				const cattrs = [`id="c${nb.n}.${i + 1}"`];
				const prev = i > 0 ? ordered[i - 1] : undefined;
				if (c.parent !== null && index.has(c.parent) && (!prev || prev.id !== c.parent)) cattrs.push(`reply-to="c${nb.n}.${index.get(c.parent)}"`);
				if (c.created) cattrs.push(`date="${escapeAttr(formatDate(c.created))}"`);
				if (c.edited) cattrs.push(`edited="${escapeAttr(formatDate(c.edited))}"`);
				commentLines.push(`  <comment ${cattrs.join(' ')}>${escapeBody(c.body)}</comment>`);
			});
			commentLines.push('</thread>');
		}
	}

	// --- Notation -----------------------------------------------------------
	const notation: string[] = [];
	if (sel) notation.push('This is an excerpt of the document (the current selection), not the whole text.');
	if (flags.milestones) notation.push('⟦cN⟧…⟦/cN⟧ marks the exact text that comment thread cN refers to. Ranges may overlap or nest.');
	if (mode !== 'comments' && hasHighlight(md, selFrom, selTo, code)) notation.push('==text== is highlighted text with no comment.');
	if (flags.footnotes) notation.push('[^n] marks a footnote; definitions are in <footnotes>.');
	if (flags.embeds && embedMode === 'inline' && options.resolveEmbed) notation.push('<embed source="…">…</embed> holds the content of another note that is embedded (shown inline) at that point.');
	else if (flags.embeds) notation.push('[embed: note] marks another note embedded at that point (content not included).');
	if (flags.images) notation.push('[image: file — alt text] stands for an embedded image.');
	if (flags.private) notation.push('%%…%% is a private note-to-self by the author, hidden when the note is displayed.');
	if (mode !== 'text' && numbered.length) {
		notation.push(
			mode === 'comments'
				? 'Each thread quotes the text it refers to in its anchor. Inside a thread, comments are in time order; reply-to names the earlier comment being answered when it is not the one directly above.'
				: 'Threads follow the document. Inside a thread, comments are in time order; reply-to names the earlier comment being answered when it is not the one directly above.',
		);
		notation.push('status is open or resolved.' + (detachedCount ? ' detached="true" means the commented text was deleted; the anchor is the last known quote.' : ''));
	}
	const notationBlock = notation.length ? `<notation>\n${notation.join('\n')}\n</notation>\n` : '';

	// --- Assemble -----------------------------------------------------------
	const parts: string[] = [];
	if (mode === 'comments') {
		parts.push(`${notationBlock}<comments document="${escapeAttr(title)}">\n${commentLines.join('\n')}\n</comments>`);
	} else {
		parts.push(`<document title="${escapeAttr(title)}">\n${notationBlock}${notationBlock ? '\n' : ''}${docText}\n</document>`);
		if (footnoteLines.length) parts.push(`<footnotes>\n${footnoteLines.join('\n')}\n</footnotes>`);
		if (commentLines.length) parts.push(`<comments>\n${commentLines.join('\n')}\n</comments>`);
	}
	const text = parts.join('\n\n') + '\n';
	const words = countWords(docText.replace(/⟦\/?c\d+⟧/g, ''));
	return { text, stats: { words, threads: numbered.length, resolvedOmitted, detached: detachedCount } };
}

function stripAll(s: string): string {
	return s.replace(/​?<!--\/?c:[A-Za-z0-9]+-->/g, '');
}

function hasHighlight(md: string, from: number, to: number, code: Range[]): boolean {
	const re = /==[^=\n](?:[^\n]*?[^=\n])?==/g;
	re.lastIndex = from;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md)) && m.index < to) if (!inRanges(m.index, code)) return true;
	return false;
}

export function countWords(text: string): number {
	const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
	return m ? m.length : 0;
}

/** "Copied: 2,431 words, 6 threads (2 resolved omitted)" */
export function exportSummary(stats: ExportStats, mode: ExportMode = 'full'): string {
	const n = (x: number) => x.toLocaleString('en-US');
	const parts: string[] = [];
	if (mode !== 'comments') parts.push(`${n(stats.words)} words`);
	if (mode !== 'text') parts.push(`${n(stats.threads)} thread${stats.threads === 1 ? '' : 's'}`);
	let s = `Copied: ${parts.join(', ')}`;
	if (mode !== 'text' && stats.resolvedOmitted) s += ` (${stats.resolvedOmitted} resolved omitted)`;
	return s;
}
