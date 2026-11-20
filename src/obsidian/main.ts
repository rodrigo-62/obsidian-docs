import { Plugin } from 'obsidian';

export default class FolioPlugin extends Plugin {
	async onload(): Promise<void> {
		console.log('[folio] loaded');
	}
}
