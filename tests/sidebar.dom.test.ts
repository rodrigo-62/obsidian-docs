// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installDomHelpers, MarkdownView } from './mocks/obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { commentExtensions } from '../src/obsidian/cm';
import { CommentsSidebarView } from '../src/obsidian/sidebarView';
import { closeMarker as c, openMarker as o } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import { createThread } from '../src/core/model';

beforeAll(installDomHelpers);

describe('comments sidebar', () => {
	it('lists the threads of the source note', async () => {
		const doc = `A ${o('a')}one${c('a')} B ${o('b')}two${c('b')}\n\n${serializeThreadBlock({ a: createThread('one', 'first'), b: createThread('two', 'second'), d: createThread('gone', 'detached') })}\n`;
		const cm = new EditorView({ state: EditorState.create({ doc, extensions: [commentExtensions()] }), parent: document.body });
		const md = new MarkdownView();
		md.file = { path: 'n.md', basename: 'n' };
		md.editor = { cm };
		const plugin = { lastMarkdownView: () => md, settings: { showResolved: false }, isTree: () => false } as never;
		const view = new CommentsSidebarView({ app: { workspace: { on: () => ({}) } } } as never, plugin);
		await (view as unknown as { load: () => Promise<void> }).load(); // throws if a field shadows ItemView.titleEl
		const el = (view as unknown as { contentEl: HTMLElement }).contentEl;
		expect(el.querySelector('.folio-sidebar-title')!.textContent).toBe('n');
		expect(el.querySelectorAll('.folio-card').length).toBe(3);
		expect(el.querySelector('.folio-card-quote')!.textContent).toBe('one');
		expect(el.querySelector('.folio-detached-header')!.textContent).toBe('Detached comments (1)');
		cm.destroy();
	});
});
