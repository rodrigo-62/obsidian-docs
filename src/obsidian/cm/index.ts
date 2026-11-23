import { Prec, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';
import { clipboardHandlers, editFilter, searchReplaceFilter } from './filters';
import { folioField } from './state';

export { folioField } from './state';

/** Editor extensions shared by every Markdown editor (comments render even without doc mode). */
export function commentExtensions(extra: Extension[] = []): Extension {
	return [Prec.high(folioField), editFilter, searchReplaceFilter, clipboardHandlers, ...extra];
}

/** The CodeMirror view behind a MarkdownView (Obsidian exposes it as `editor.cm`). */
export function editorViewOf(view: MarkdownView | null | undefined): EditorView | null {
	const cm = (view?.editor as unknown as { cm?: EditorView } | undefined)?.cm;
	return cm ?? null;
}
