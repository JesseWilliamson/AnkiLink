import { Notice, Plugin, TFile, Vault } from "obsidian";
import {
	DEFAULT_SETTINGS,
	AnkiLinkSettings,
	AnkiLinkSettingsTab,
} from "./settings";
import { TARGET_DECK, sendAddNoteRequest, buildNote, sendCreateDeckRequest, sendDeckNamesRequest, Note, sendFindNoteRequest } from "./ankiConnectUtil";
import { FC_PREAMBLE_P } from "./regexUtil";

interface ParsedNoteData {
	id: number | undefined,
	index: number,
	note: Note
}

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
		let totalAdded = 0;
		for (const file of markdownFiles) {
			const lines = await this.readFile(vault, file);
			let linesModified = false;
			const noteDataList = this.parseDocument(lines);
			for (const noteData of noteDataList) {
				if (noteData.id == undefined) {
					noteData.id = await this.sendNote(noteData.note);
					lines[noteData.index] = `> [!flashcard] %%{noteId}%% ${noteData.note.fields.Front}`;
					linesModified = true;
					totalAdded += 1;
				} else {
					//TODO: Check if the note has changed and update it.
				}
			}
			if (linesModified) {
				await vault.modify(file, lines.join("\n"));
			}
		}
		return totalAdded;
	}

	private async readFile(vault: Vault, file: TFile): Promise<string[]> {
		return (await vault.read(file)).split("\n");
	}

	/**
	 * Read flashcard data from an obsidian document.
	 * @param lines Plain text lines from an Obsidian document
	 * @returns Flashcard data
	 */
	private parseDocument(lines: string[]): ParsedNoteData[] {
		const output = new Array<ParsedNoteData>();
		let i = 0;
		while (i < lines.length) {
			i++;
			const { id, title } = this.parsePreamble(lines[i]!) || {};
			if (!title) {
				continue;
			}

			const bodyLines = this.parseBody(lines.slice(i, -1));
			const body = bodyLines.join("<br>");
			const note = buildNote(title, body);
			output.push({ id: id ? Number(id) : undefined, index: i, note })
			i += bodyLines.length;
		}
		return output;
	}

	/**
	 * Read a flashcard body from an array of plaintext lines.
	 * @param lines Plain text lines, starting after a flashcard title line and continuing indefinitely
	 * @returns The text content of each flashcard body line with the leading > and whitespace removed
	 */
	private parseBody(lines: string[]) {
		const bodyLines: string[] = [];
		for (const line of lines) {
			if (!line.startsWith(">")) {
				return bodyLines;
			}
			bodyLines.push(line.replace(/^>\s?/, ""));
		}
		return bodyLines;
	}

	/**
	 * Read a flashcard title line and preamble.
	 * @param str A flashcard title line, including flashcard callout and optionally id comment
	 * @returns A title and optionally an id
	 */
	private parsePreamble(str: string) {
		const match = FC_PREAMBLE_P.exec(str);
		if (!match) {
			return undefined
		}
		return { id: match[1], title: match[2]!}
	}

	private async sendNote(note: Note) {
		const res = await sendAddNoteRequest(note);
		if (res.error) throw new Error(`AnkiConnect ${res.error}`);
		return res.result;
	}

	private async findNoteById(id: number) {
		const query =`nid:${id}`;
		const res = await sendFindNoteRequest(query);
		if (res.error) throw new Error(`AnkiConnect ${res.error}`);
		return res.result;
	}
}
