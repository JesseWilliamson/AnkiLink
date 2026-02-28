import { Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	AnkiLinkSettings,
	AnkiLinkSettingsTab,
} from "./settings";
import { TARGET_DECK, sendAddNoteRequest, buildNote, sendCreateDeckRequest, sendDeckNamesRequest, ConnNoteFields } from "./ankiConnectUtil";

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

		const fileContents = await Promise.all(
			vault.getMarkdownFiles().map((file) => vault.read(file)),
		);
		const pattern: RegExp =
			/\[!flashcard\]\s*([^\n]*)\n((?:>(?:[^\n]*)\n?)*)/;
		fileContents.forEach((c) => {
			const values = pattern.exec(c);
			values?.shift();
		});
		const deckNamesRes = await sendDeckNamesRequest();
		if (deckNamesRes.error) throw new Error(`AnkiConnect: ${deckNamesRes.error}`)
		const decks = deckNamesRes.result;
		if (!decks.contains(TARGET_DECK)) {
			const createDeckRes = await sendCreateDeckRequest(TARGET_DECK);
			if (createDeckRes.error) throw new Error(`AnkiConnect: ${createDeckRes.error}`)
		}
		const cards = fileContents.reduce<ConnNoteFields[]>((acc, s) => {
			const matches = pattern.exec(s);
			if (!matches || matches.length < 3) {
				return acc;
			}
			acc.push({ Front: matches[1]!, Back: matches[2]! });
			return acc;
		}, []);
		console.log(cards)
		for (const card of cards) {
			await this.sendNote(card);
		}
		const note = buildNote(
			"Cool new front note content",
			"Boring back content"
		)
		const addNoteRes = await sendAddNoteRequest(note);
		if (addNoteRes.error) throw new Error(`AnkiConnect: ${addNoteRes.error}`);

		return fileContents.length;
	}

	private async sendNote(noteFields: ConnNoteFields) {
		const note = buildNote(noteFields.Front, noteFields.Back);
		const res = await sendAddNoteRequest(note);
		if (res.error) throw new Error(`AnkiConnect ${res.error}`);
	}
}
