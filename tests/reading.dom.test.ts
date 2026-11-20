// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { installDomHelpers } from './mocks/obsidian';
import { makeReadingPostProcessor } from '../src/obsidian/reading';
import { GUARD, closeMarker as c, openMarker as o } from '../src/core/markers';
import { serializeThreadBlock } from '../src/core/threadStore';
import { createThread, setResolved } from '../src/core/model';

beforeAll(installDomHelpers);

const threads = { a: createThread('', 'x'), b: createThread('', 'y'), r: setResolved(createThread('', 'z'), true) };
const md = [
	'# Title',
	'',
	`${GUARD}${o('a')}The **question** I want${c('a')} to pursue, and the ${o('b')}question${c('b')} again.`,
	'',
	`A ${o('r')}resolved bit${c('r')} here.`,
	'',
	serializeThreadBlock(threads),
	'',
].join('\n');

function run(html: string, lineStart: number, showResolved = false) {
	const el = document.createElement('div');
	el.innerHTML = html;
	makeReadingPostProcessor(() => showResolved)(el, { sourcePath: 'n.md', getSectionInfo: () => ({ text: md, lineStart, lineEnd: lineStart }) } as never);
	return el;
}

describe('reading view highlights', () => {
	it('wraps commented text across inline formatting', () => {
		const el = run('<p>The <strong>question</strong> I want to pursue, and the question again.</p>', 2);
		const spans = Array.from(el.querySelectorAll('[data-folio-id="a"]')).map((s) => s.textContent);
		expect(spans.join('')).toBe('The question I want');
		// the second "question" belongs to thread b, not the first occurrence
		const b = el.querySelector('[data-folio-id="b"]')!;
		expect(b.textContent).toBe('question');
		expect(b.parentElement!.tagName).toBe('P');
		expect(el.textContent).toBe('The question I want to pursue, and the question again.');
	});

	it('skips resolved threads unless shown', () => {
		expect(run('<p>A resolved bit here.</p>', 4).querySelector('.folio-hl')).toBeNull();
		expect(run('<p>A resolved bit here.</p>', 4, true).querySelector('.folio-hl-resolved')!.textContent).toBe('resolved bit');
	});

	it('leaves sections without anchors alone', () => {
		expect(run('<h1>Title</h1>', 0).innerHTML).toBe('<h1>Title</h1>');
	});
});
