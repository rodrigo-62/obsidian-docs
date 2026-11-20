// Footnote insert/navigate (one hotkey, Ctrl+Alt+F). Pure TypeScript.
//
// - cursor in a footnote definition  → go back to its reference
// - cursor on a reference [^x]        → go to its definition (created if missing)
// - anywhere else                     → insert the next numbered [^n] at the cursor
//                                       and a "[^n]: " definition, cursor in it

import { codeAndFrontmatterRanges, inRanges, type Range } from './mdScan';
import { findThreadBlock, type Change } from './threadStore';

export interface FootnoteDef {
	label: string;
	/** Whole definition, including continuation lines. */
	from: number;
	to: number;
	/** End of the definition's text (where to put the cursor). */
	textEnd: number;
}

export interface FootnoteRef {
	label: string;
	from: number;
	to: number;
}

export type FootnoteAction =
	| { kind: 'insert'; label: string; changes: Change[]; cursor: number; refEnd: number }
	| { kind: 'toDefinition'; label: string; pos: number; changes: Change[]; refEnd: number }
	| { kind: 'toReference'; label: string; pos: number };

function contentEndOf(md: string): number {
	const b = findThreadBlock(md);
	let end = b ? b.contentEnd : md.length;
	while (end > 0 && /\s/.test(md[end - 1] as string)) end--;
	return end;
}

export function scanFootnotes(md: string, end = contentEndOf(md)): { defs: FootnoteDef[]; refs: FootnoteRef[]; code: Range[] } {
	const code = codeAndFrontmatterRanges(md, end);
	const defs: FootnoteDef[] = [];
	const defRe = /^\[\^([^\]\n]+)\]:[ \t]?/gm;
	let m: RegExpExecArray | null;
	while ((m = defRe.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		let lineEnd = md.indexOf('\n', m.index);
		if (lineEnd === -1 || lineEnd > end) lineEnd = end;
		let to = lineEnd;
		// indented continuation lines (possibly after blank lines)
		let pos = lineEnd + 1;
		while (pos < end) {
			const nl = md.indexOf('\n', pos);
			const le = nl === -1 || nl > end ? end : nl;
			const line = md.slice(pos, le);
			if (/^(\t| {2,})\S/.test(line)) {
				to = le;
				pos = le + 1;
			} else if (line.trim() === '') {
				const rest = md.slice(le + 1, end);
				if (/^(\s*\n)*(\t| {2,})\S/.test(rest)) pos = le + 1;
				else break;
			} else break;
		}
		defs.push({ label: m[1] as string, from: m.index, to, textEnd: to });
	}
	const refs: FootnoteRef[] = [];
	const refRe = /\[\^([^\]\n]+)\]/g;
	while ((m = refRe.exec(md)) && m.index < end) {
		if (inRanges(m.index, code)) continue;
		if (defs.some((d) => d.from === m!.index)) continue;
		refs.push({ label: m[1] as string, from: m.index, to: m.index + m[0].length });
	}
	return { defs, refs, code };
}

function nextLabel(defs: FootnoteDef[], refs: FootnoteRef[]): string {
	let max = 0;
	for (const x of [...defs, ...refs]) if (/^\d+$/.test(x.label)) max = Math.max(max, Number(x.label));
	return String(max + 1);
}

/** Where a new definition goes: after the last definition, else at the end of the text. */
function definitionInsert(md: string, defs: FootnoteDef[], label: string): Change {
	const end = contentEndOf(md);
	const last = defs[defs.length - 1];
	const at = last ? last.to : end;
	const prefix = at === 0 ? '' : '\n\n';
	return { from: at, to: at, insert: `${prefix}[^${label}]: ` };
}

export function footnoteAction(md: string, cursor: number): FootnoteAction {
	const { defs, refs } = scanFootnotes(md);
	const inDef = defs.find((d) => cursor >= d.from && cursor <= d.to);
	if (inDef) {
		const ref = refs.find((r) => r.label === inDef.label);
		if (ref) return { kind: 'toReference', label: inDef.label, pos: ref.to };
	}
	const onRef = refs.find((r) => cursor >= r.from && cursor <= r.to);
	if (onRef) {
		const def = defs.find((d) => d.label === onRef.label);
		if (def) return { kind: 'toDefinition', label: onRef.label, pos: def.textEnd, changes: [], refEnd: onRef.to };
		const ins = definitionInsert(md, defs, onRef.label);
		return { kind: 'toDefinition', label: onRef.label, pos: ins.from + ins.insert.length, changes: [ins], refEnd: onRef.to };
	}
	const label = nextLabel(defs, refs);
	const ref: Change = { from: cursor, to: cursor, insert: `[^${label}]` };
	const def = definitionInsert(md, defs, label);
	// Both are insertions; the reference comes first when they share a position.
	const defFirst = def.from < cursor;
	const changes = defFirst ? [def, ref] : [ref, def];
	const defEnd = defFirst ? def.from + def.insert.length : def.from + ref.insert.length + def.insert.length;
	const refEnd = defFirst ? cursor + def.insert.length + ref.insert.length : cursor + ref.insert.length;
	return { kind: 'insert', label, changes, cursor: defEnd, refEnd };
}
