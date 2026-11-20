import { describe, expect, it } from 'vitest';
import { adjacentHeading, headings } from '../src/core/headings';
import { serializeThreadBlock } from '../src/core/threadStore';

const md = '---\ntitle: x\n---\n# One\n\ntext\n\n```\n# not a heading\n```\n## Two\nmore\n#nottag heading\n### Three\n';

describe('headings', () => {
	it('finds ATX headings outside code and frontmatter', () => {
		expect(headings(md).map((h) => [h.level, md.slice(h.text, md.indexOf('\n', h.text))])).toEqual([
			[1, 'One'],
			[2, 'Two'],
			[3, 'Three'],
		]);
	});

	it('moves to the next and previous heading', () => {
		const inText = md.indexOf('text');
		expect(md.slice(adjacentHeading(md, inText, 1)!.text).startsWith('Two')).toBe(true);
		expect(md.slice(adjacentHeading(md, inText, -1)!.text).startsWith('One')).toBe(true);
		const onTwo = md.indexOf('## Two') + 4;
		expect(md.slice(adjacentHeading(md, onTwo, 1)!.text).startsWith('Three')).toBe(true);
		expect(md.slice(adjacentHeading(md, onTwo, -1)!.text).startsWith('One')).toBe(true);
		expect(adjacentHeading(md, md.length, 1)).toBeNull();
	});

	it('ignores the hidden thread block', () => {
		const m = `# A\n\n${serializeThreadBlock({})}\n`;
		expect(headings(m).length).toBe(1);
	});
});
