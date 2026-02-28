import { App, TFile } from "obsidian";
import {
	Note,
	TARGET_DECK,
	buildNote,
	getNoteById,
	sendAddNoteRequest,
	sendCreateDeckRequest,
	sendDeckNamesRequest,
	updateNoteById,
} from "./ankiConnectUtil";
import { FC_PREAMBLE_P } from "./regexUtil";

interface ParsedNoteData {
	id: number | undefined;
	index: number;
	note: Note;
}

interface NoteSyncResult {
	added: number;
	modified: number;
	linesModified: boolean;
	lines: string[];
}

export interface SyncSummary {
	added: number;
	modified: number;
}

export async function syncVaultNotes(app: App): Promise<SyncSummary> {
	const markdownFiles = app.vault.getMarkdownFiles();
	await addMissingDecks();

	let totalAdded = 0;
	let totalModified = 0;
	for (const file of markdownFiles) {
		const result = await syncSingleFile(app, file);
		totalAdded += result.added;
		totalModified += result.modified;
	}
	return { added: totalAdded, modified: totalModified };
}

async function syncSingleFile(app: App, file: TFile): Promise<SyncSummary> {
	const originalLines = (await app.vault.read(file)).split("\n");
	const notesData = parseDocument(originalLines);
	if (notesData.length === 0) return { added: 0, modified: 0 };

	let totalAdded = 0;
	let totalModified = 0;
	let linesModified = false;
	let lines = originalLines;
	for (const noteData of notesData) {
		const result = await syncSingleNote(noteData, lines);
		totalAdded += result.added;
		totalModified += result.modified;
		linesModified = linesModified || result.linesModified;
		lines = result.lines;
	}

	if (linesModified) {
		await app.vault.modify(file, lines.join("\n"));
	}
	return { added: totalAdded, modified: totalModified };
}

async function syncSingleNote(noteData: ParsedNoteData, lines: string[]): Promise<NoteSyncResult> {
	if (noteData.id == undefined) {
		return createAndWriteNoteId(noteData, lines);
	}

	const ankiNote = await getNoteById(noteData.id);
	if (!ankiNote) {
		// Missing note for this ID in Anki (notesInfo returned [] or [{}]). Recreate it.
		return createAndWriteNoteId(noteData, lines);
	}

	const obsidianFields = noteData.note.fields;
	const ankiFields = ankiNote.fields;
	if (obsidianFields.Front !== ankiFields.Front.value || obsidianFields.Back !== ankiFields.Back.value) {
		await updateNoteById(ankiNote.noteId, obsidianFields);
		return { added: 0, modified: 1, linesModified: false, lines };
	}
	return { added: 0, modified: 0, linesModified: false, lines };
}

async function createAndWriteNoteId(noteData: ParsedNoteData, lines: string[]): Promise<NoteSyncResult> {
	const newId = await sendNote(noteData.note);
	const updatedLines = [...lines];
	updatedLines[noteData.index] = `> [!flashcard] %%${newId}%% ${noteData.note.fields.Front}`;
	return { added: 1, modified: 0, linesModified: true, lines: updatedLines };
}

async function addMissingDecks() {
	const deckNamesRes = await sendDeckNamesRequest();
	if (deckNamesRes.error) throw new Error(`AnkiConnect: ${deckNamesRes.error}`);
	const decks = deckNamesRes.result;
	if (!decks.includes(TARGET_DECK)) {
		const createDeckRes = await sendCreateDeckRequest(TARGET_DECK);
		if (createDeckRes.error) throw new Error(`AnkiConnect: ${createDeckRes.error}`);
	}
}

function parseDocument(lines: string[]): ParsedNoteData[] {
	const output = new Array<ParsedNoteData>();
	let i = 0;
	while (i < lines.length) {
		const { id, title } = parsePreamble(lines[i]!) || {};
		if (!title) {
			i++;
			continue;
		}

		const bodyLines = parseBody(lines.slice(i + 1));
		const body = bodyLines.join("<br>");
		const note = buildNote(title, body);
		output.push({ id: id ? Number(id) : undefined, index: i, note });
		i += bodyLines.length + 1;
	}
	return output;
}

function parseBody(lines: string[]) {
	const bodyLines: string[] = [];
	for (const line of lines) {
		// Stop when we reach the next flashcard preamble.
		if (parsePreamble(line)) {
			return bodyLines;
		}
		if (!line.startsWith(">")) {
			return bodyLines;
		}
		bodyLines.push(line.replace(/^>\s?/, ""));
	}
	return bodyLines;
}

function parsePreamble(str: string) {
	const match = FC_PREAMBLE_P.exec(str);
	if (!match) {
		return undefined;
	}
	return { id: match[1], title: match[2]! };
}

async function sendNote(note: Note): Promise<number> {
	const res = await sendAddNoteRequest(note);
	if (res.error) throw new Error(`AnkiConnect ${res.error}`);
	return res.result;
}
