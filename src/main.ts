import { Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	AnkiLinkSettings,
	AnkiLinkSettingsTab,
} from "./settings";
import { TARGET_DECK, sendAddNoteRequest, buildNote, sendCreateDeckRequest, sendDeckNamesRequest, ConnNoteFields, ConnNote } from "./ankiConnectUtil";
import { FLASHCARD_PATTERN, splitCalloutBody } from "./regexUtil";

export default class AnkiLink extends Plugin {
	settings!: AnkiLinkSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon(
			"circle-question-mark",
			"Sample",
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				const numStr = this.parse().then((n) => n.toString());
				numStr.then(
					(n) => new Notice(n),
					(e) => console.error(e),
				);
			},
		);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "sync-cards",
			name: "Sync cards",
			callback: () => {},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AnkiLinkSettingsTab(this.app, this));
	}

	onunload() {
		// Put unload code here
	}

	async loadSettings() {
		this.settings = {
			...DEFAULT_SETTINGS,
			...((await this.loadData()) as Partial<AnkiLinkSettings>),
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async parse(): Promise<number> {
		const { vault } = this.app;

		const markdownFiles = vault.getMarkdownFiles();

		const deckNamesRes = await sendDeckNamesRequest();
		if (deckNamesRes.error) throw new Error(`AnkiConnect: ${deckNamesRes.error}`)
		const decks = deckNamesRes.result;
		if (!decks.contains(TARGET_DECK)) {
			const createDeckRes = await sendCreateDeckRequest(TARGET_DECK);
			if (createDeckRes.error) throw new Error(`AnkiConnect: ${createDeckRes.error}`)
		}
		for (const file of markdownFiles) {
			const s = await vault.read(file);
			const match = FLASHCARD_PATTERN.exec(s);
			if (!match || match.length < 3) {
				continue;
			}
			const title = match[1]!;
			const rawBody = match[2]!;
			const splitBody = splitCalloutBody(rawBody);
			const card = buildNote(title, splitBody)
			const index = await this.sendNote(card);
			console.log(title.length);
			const endIndex = match.index + title.length + 13;
			const indexedFileContent = this.spliceString(s, endIndex, index.toString());
			await vault.modify(file, indexedFileContent);
		}
		return 0;
	}

	private spliceString(base: string, index: number, item: string): string {
		const s1 = base.slice(0, index);
		const s2 = base.slice(index, - 1)
		return s1 + item + s2;
	}

	private async sendNote(note: ConnNote) {
		const res = await sendAddNoteRequest(note);
		if (res.error) throw new Error(`AnkiConnect ${res.error}`);
		return res.result;
	}
}
