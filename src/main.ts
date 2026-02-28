import { Notice, Plugin, TFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	AnkiLinkSettings,
	AnkiLinkSettingsTab,
} from "./settings";
import { TARGET_DECK, sendAddNoteRequest, buildNote, sendCreateDeckRequest, sendDeckNamesRequest, Note, getNoteById, updateNoteById } from "./ankiConnectUtil";
import { FC_PREAMBLE_P } from "./regexUtil";

interface ParsedNoteData {
	id: number | undefined,
	index: number,
	note: Note
}

interface NoteSyncResult {
	added: number;
	linesModified: boolean;
	lines: string[];
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
				const numStr = this.syncNotes().then((n) => n.toString());
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

	/**
	 * Sync all notes from all markdown files in the vault.
	 * @returns The number of notes added
	 */
	async syncNotes(): Promise<number> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		await this.addMissingDecks();

		let totalAdded = 0;
		for (const file of markdownFiles) {
			const added = await this.syncSingleFile(file);
			totalAdded += added;
		}
		return totalAdded;
	}

	/**
	 * Sync all notes from a document. Updates the document lines to include the new note IDs.
	 * @param file The document to sync
	 * @returns The number of notes added
	 */
	private async syncSingleFile(file: TFile): Promise<number> {
		const originalLines = (await this.app.vault.read(file)).split("\n");
		const notesData = this.parseDocument(originalLines);
		if (notesData.length === 0) return 0;

		let totalAdded = 0;
		let linesModified = false;
		let lines = originalLines;
		for (const noteData of notesData) {
			const result = await this.syncSingleNote(noteData, lines);
			totalAdded += result.added;
			linesModified = result.linesModified;
			lines = result.lines;
		}

		if (linesModified) {
			await this.app.vault.modify(file, lines.join("\n"));
		}
		return totalAdded;
	}

	/**
	 * Sync a single extracted note from a document.
	 * @param noteData The note data to sync
	 * @param lines The lines of the document
	 * @returns The note sync result
	 */
	private async syncSingleNote(noteData: ParsedNoteData, lines: string[]): Promise<NoteSyncResult> {
		if (noteData.id == undefined) {
			return this.createAndWriteNoteId(noteData, lines);
		}

		const ankiNote = await getNoteById(noteData.id);
		if (!ankiNote) {
			// Missing note for this ID in Anki (notesInfo returned [] or [{}]). Recreate it.
			return this.createAndWriteNoteId(noteData, lines);
		}

		const obsidianFields = noteData.note.fields;
		const ankiFields = ankiNote.fields;
		if (obsidianFields.Front !== ankiFields.Front.value || obsidianFields.Back !== ankiFields.Back.value) {
			await updateNoteById(ankiNote.noteId, obsidianFields);
		}
		return { added: 0, linesModified: false, lines };
	}

	/**
	 * Create a new note in Anki and update document lines to include the new note ID.
	 * @param noteData The note data to create
	 * @param lines The lines of the document
	 * @returns The note sync result
	 */
	private async createAndWriteNoteId(noteData: ParsedNoteData, lines: string[]): Promise<NoteSyncResult> {
		const newId = await this.sendNote(noteData.note);
		const updatedLines = [...lines];
		updatedLines[noteData.index] = `> [!flashcard] %%${newId}%% ${noteData.note.fields.Front}`;
		return { added: 1, linesModified: true, lines: updatedLines };
	}

	/**
	 * Check if the target deck exists in Anki and create it if it doesn't.
	 */
	private async addMissingDecks() {
		const deckNamesRes = await sendDeckNamesRequest();
		if (deckNamesRes.error) throw new Error(`AnkiConnect: ${deckNamesRes.error}`)
		const decks = deckNamesRes.result;
		if (!decks.includes(TARGET_DECK)) {
			const createDeckRes = await sendCreateDeckRequest(TARGET_DECK);
			if (createDeckRes.error) throw new Error(`AnkiConnect: ${createDeckRes.error}`)
		}
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
			const { id, title } = this.parsePreamble(lines[i]!) || {};
			if (!title) {
				i++;
				continue;
			}

			const bodyLines = this.parseBody(lines.slice(i + 1));
			const body = bodyLines.join("<br>");
			const note = buildNote(title, body);
			output.push({ id: id ? Number(id) : undefined, index: i, note });
			i += bodyLines.length + 1;
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
			// Stop when we reach the next flashcard preamble.
			if (this.parsePreamble(line)) {
				return bodyLines;
			}
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

	private async sendNote(note: Note): Promise<number> {
		const res = await sendAddNoteRequest(note);
		if (res.error) throw new Error(`AnkiConnect ${res.error}`);
		return res.result;
	}
}
