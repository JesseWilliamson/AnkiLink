import { App, TFile } from "obsidian";
import { remark } from "remark";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import {
	ANKI_LINK_MODEL_NAME,
	ANKI_LINK_TAG,
	Note,
	addTagToNotes,
	buildNote,
	deleteNotesById,
	findNoteIdsByTag,
	getNoteById,
	moveNoteToDeck,
	noteHasTag,
	noteIsInDeck,
	sendAddNoteRequest,
	sendCreateDeckRequest,
	sendCreateModelRequest,
	sendDeckNamesRequest,
	sendModelNamesRequest,
	sendUpdateModelStylingRequest,
	sendUpdateModelTemplatesRequest,
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
	noteId: number;
}

export interface SyncSummary {
	added: number;
	modified: number;
	deleted: number;
}

interface FileSyncResult {
	added: number;
	modified: number;
	notesInDocument: Set<number>;
}

export async function syncVaultNotes(app: App): Promise<SyncSummary> {
	const markdownFiles = app.vault.getMarkdownFiles();
	const fileDecks = new Map<string, string>();
	const decksInUse = new Set<string>();
	for (const file of markdownFiles) {
		const deckName = await getDeckNameForFile(app, file);
		if (!deckName) continue;
		fileDecks.set(file.path, deckName);
		decksInUse.add(deckName);
	}

	await ensureDecksExist(decksInUse);
	await ensureModelIsConfigured();
	const taggedNoteIdsAtStart = new Set(await findNoteIdsByTag(ANKI_LINK_TAG));

	let totalAdded = 0;
	let totalModified = 0;
	const seenNoteIds = new Set<number>();
	for (const file of markdownFiles) {
		const deckName = fileDecks.get(file.path);
		if (!deckName) continue;

		const result = await syncSingleFile(app, file, deckName);
		totalAdded += result.added;
		totalModified += result.modified;
		for (const noteId of result.notesInDocument) {
			seenNoteIds.add(noteId);
		}
	}

	const orphanedNoteIds = [...taggedNoteIdsAtStart].filter((noteId) => !seenNoteIds.has(noteId));
	await deleteNotesById(orphanedNoteIds);

	return { added: totalAdded, modified: totalModified, deleted: orphanedNoteIds.length };
}

async function syncSingleFile(app: App, file: TFile, deckName: string): Promise<FileSyncResult> {
	const originalLines = (await app.vault.read(file)).split("\n");
	const notesData = parseDocument(originalLines, deckName);
	if (notesData.length === 0) return { added: 0, modified: 0, notesInDocument: new Set() };

	let totalAdded = 0;
	let totalModified = 0;
	let linesModified = false;
	let lines = originalLines;
	const notesInDocument = new Set<number>();
	for (const noteData of notesData) {
		const result = await syncSingleNote(noteData, lines, deckName);
		totalAdded += result.added;
		totalModified += result.modified;
		linesModified = linesModified || result.linesModified;
		lines = result.lines;
		notesInDocument.add(result.noteId);
	}

	if (linesModified) {
		await app.vault.modify(file, lines.join("\n"));
	}
	return { added: totalAdded, modified: totalModified, notesInDocument };
}

async function syncSingleNote(noteData: ParsedNoteData, lines: string[], deckName: string | undefined): Promise<NoteSyncResult> {
	if (noteData.id == undefined) {
		return createAndWriteNoteId(noteData, lines);
	}

	const ankiNote = await getNoteById(noteData.id);
	if (!ankiNote) {
		// Missing note for this ID in Anki (notesInfo returned [] or [{}]). Recreate it.
		return createAndWriteNoteId(noteData, lines);
	}

	if (!noteHasTag(ankiNote, ANKI_LINK_TAG)) {
		await addTagToNotes([ankiNote.noteId], ANKI_LINK_TAG);
		return { added: 0, modified: 0, linesModified: false, lines, noteId: ankiNote.noteId };
	}

	let noteWasModified = false;
	if (deckName && !(await noteIsInDeck(ankiNote.noteId, deckName))) {
		await moveNoteToDeck(ankiNote.noteId, deckName);
		noteWasModified = true;
	}

	const obsidianFields = noteData.note.fields;
	const ankiFields = ankiNote.fields;
	if (obsidianFields.Front !== ankiFields.Front.value || obsidianFields.Back !== ankiFields.Back.value) {
		await updateNoteById(ankiNote.noteId, obsidianFields);
		noteWasModified = true;
	}
	return { added: 0, modified: noteWasModified ? 1 : 0, linesModified: false, lines, noteId: ankiNote.noteId };
}

async function createAndWriteNoteId(noteData: ParsedNoteData, lines: string[]): Promise<NoteSyncResult> {
	const newId = await sendNote(noteData.note);
	const updatedLines = [...lines];
	updatedLines[noteData.index] = `> [!flashcard] %%${newId}%% ${noteData.note.fields.Front}`;
	return { added: 1, modified: 0, linesModified: true, lines: updatedLines, noteId: newId };
}

async function ensureDecksExist(deckNames: Set<string>) {
	if (deckNames.size === 0) return;
	const deckNamesRes = await sendDeckNamesRequest();
	if (deckNamesRes.error) throw new Error(`AnkiConnect: ${deckNamesRes.error}`);
	const existingDecks = new Set(deckNamesRes.result);
	for (const deckName of deckNames) {
		if (existingDecks.has(deckName)) continue;
		const createDeckRes = await sendCreateDeckRequest(deckName);
		if (createDeckRes.error) throw new Error(`AnkiConnect: ${createDeckRes.error}`);
	}
}

async function ensureModelIsConfigured() {
	const modelNamesRes = await sendModelNamesRequest();
	if (modelNamesRes.error) throw new Error(`AnkiConnect: ${modelNamesRes.error}`);
	if (!modelNamesRes.result.includes(ANKI_LINK_MODEL_NAME)) {
		const createModelRes = await sendCreateModelRequest(ANKI_LINK_MODEL_NAME);
		if (createModelRes.error) throw new Error(`AnkiConnect: ${createModelRes.error}`);
	}
	const updateTemplatesRes = await sendUpdateModelTemplatesRequest(ANKI_LINK_MODEL_NAME);
	if (updateTemplatesRes.error) throw new Error(`AnkiConnect: ${updateTemplatesRes.error}`);
	const updateStylingRes = await sendUpdateModelStylingRequest(ANKI_LINK_MODEL_NAME);
	if (updateStylingRes.error) throw new Error(`AnkiConnect: ${updateStylingRes.error}`);
}

function parseDocument(lines: string[], deckName: string): ParsedNoteData[] {
	const output = new Array<ParsedNoteData>();
	let i = 0;
	while (i < lines.length) {
		const { id, title } = parsePreamble(lines[i]!) || {};
		if (!title) {
			i++;
			continue;
		}

		const bodyLines = parseBody(lines.slice(i + 1));
		const body = formatBodyForAnki(bodyLines);
		const note = buildNote(title, body, deckName);
		output.push({ id: id ? Number(id) : undefined, index: i, note });
		i += bodyLines.length + 1;
	}
	return output;
}

type BodyToken =
	| { type: "text"; raw: string }
	| { type: "fence"; raw: string; marker: "```" | "~~~" | "$$"; info: string };

type BodySegment =
	| { type: "text"; lines: string[] }
	| { type: "code"; language: string; code: string }
	| { type: "math"; latex: string };

const MATH_INLINE_OPEN = String.raw`\(`;
const MATH_INLINE_CLOSE = String.raw`\)`;
const MATH_BLOCK_OPEN = String.raw`\[`;
const MATH_BLOCK_CLOSE = String.raw`\]`;
const MARKDOWN_PROCESSOR = remark()
	.use(remarkGfm)
	.use(remarkBreaks)
	.use(remarkHtml, { sanitize: false });

function formatBodyForAnki(lines: string[]): string {
	const tokens = lexBody(lines);
	const segments = parseBodyTokens(tokens);
	return renderBodySegments(segments);
}

function lexBody(lines: string[]): BodyToken[] {
	return lines.map((line) => lexLine(line));
}

function lexLine(line: string): BodyToken {
	const trimmed = line.trim();
	if (trimmed === "$$") {
		return { type: "fence", raw: line, marker: "$$", info: "" };
	}
	if (trimmed.startsWith("```")) {
		return { type: "fence", raw: line, marker: "```", info: trimmed.slice(3).trim() };
	}
	if (trimmed.startsWith("~~~")) {
		return { type: "fence", raw: line, marker: "~~~", info: trimmed.slice(3).trim() };
	}
	return { type: "text", raw: line };
}

function parseBodyTokens(tokens: BodyToken[]): BodySegment[] {
	const segments: BodySegment[] = [];
	const textBuffer: string[] = [];

	const flushText = () => {
		if (textBuffer.length === 0) return;
		segments.push({ type: "text", lines: [...textBuffer] });
		textBuffer.length = 0;
	};

	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i]!;
		if (token.type !== "fence") {
			textBuffer.push(token.raw);
			i++;
			continue;
		}

		if (token.marker === "$$") {
			const closingMathIdx = findClosingFenceToken(tokens, i + 1, "$$");
			if (closingMathIdx === -1) {
				textBuffer.push(token.raw);
				i++;
				continue;
			}

			flushText();
			const latex = tokens.slice(i + 1, closingMathIdx).map((currentToken) => currentToken.raw).join("\n");
			segments.push({ type: "math", latex });
			i = closingMathIdx + 1;
			continue;
		}

		const closingFenceIdx = findClosingFenceToken(tokens, i + 1, token.marker);
		if (closingFenceIdx === -1) {
			// Keep unmatched fences as regular text to avoid dropping content.
			textBuffer.push(token.raw);
			i++;
			continue;
		}

		flushText();
		const code = tokens.slice(i + 1, closingFenceIdx).map((currentToken) => currentToken.raw).join("\n");
		segments.push({ type: "code", language: token.info, code });
		i = closingFenceIdx + 1;
	}

	flushText();
	return segments;
}

function findClosingFenceToken(tokens: BodyToken[], startIdx: number, marker: "```" | "~~~" | "$$"): number {
	for (let i = startIdx; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.type === "fence" && token.marker === marker && token.info.length === 0) {
			return i;
		}
	}
	return -1;
}

function renderBodySegments(segments: BodySegment[]): string {
	return segments.map((segment) => renderSegment(segment)).join("\n");
}

function renderSegment(segment: BodySegment): string {
	if (segment.type === "text") {
		return renderMarkdownText(segment.lines);
	}
	if (segment.type === "code") {
		const languageClass = segment.language.length > 0 ? ` class="language-${escapeHtmlAttribute(segment.language)}"` : "";
		return `<pre><code${languageClass}>${escapeHtml(segment.code)}</code></pre>`;
	}
	return MATH_BLOCK_OPEN + segment.latex + MATH_BLOCK_CLOSE;
}

function renderMarkdownText(lines: string[]): string {
	const markdown = lines.join("\n");
	const { markdownWithPlaceholders, replacements } = extractInlineMathPlaceholders(markdown);
	let rendered = String(MARKDOWN_PROCESSOR.processSync(markdownWithPlaceholders)).trim();
	for (const [placeholder, replacement] of replacements) {
		rendered = rendered.split(placeholder).join(replacement);
	}
	return rendered;
}

function extractInlineMathPlaceholders(markdown: string): {
	markdownWithPlaceholders: string;
	replacements: Map<string, string>;
} {
	let output = "";
	const replacements = new Map<string, string>();
	let placeholderCounter = 0;
	let i = 0;
	while (i < markdown.length) {
		const inlineCode = consumeInlineCode(markdown, i);
		if (inlineCode) {
			output += inlineCode.text;
			i += inlineCode.length;
			continue;
		}

		const inlineMath = consumeInlineMath(markdown, i, placeholderCounter);
		if (!inlineMath) {
			output += markdown[i]!;
			i++;
			continue;
		}

		output += inlineMath.placeholder;
		replacements.set(inlineMath.placeholder, inlineMath.replacement);
		placeholderCounter = inlineMath.nextPlaceholderCounter;
		i += inlineMath.length;
	}
	return { markdownWithPlaceholders: output, replacements };
}

function consumeInlineCode(input: string, startIdx: number): { text: string; length: number } | null {
	const char = input[startIdx];
	if (char !== "`" || isEscaped(input, startIdx)) return null;

	const tickRunLength = countSameCharRun(input, startIdx, "`");
	const closeTickIdx = findMatchingTickRun(input, startIdx + tickRunLength, tickRunLength);
	if (closeTickIdx === -1) return null;

	const endIdx = closeTickIdx + tickRunLength;
	return { text: input.slice(startIdx, endIdx), length: endIdx - startIdx };
}

function consumeInlineMath(
	input: string,
	startIdx: number,
	placeholderCounter: number,
): { placeholder: string; replacement: string; length: number; nextPlaceholderCounter: number } | null {
	const char = input[startIdx];
	if (char !== "$" || isEscaped(input, startIdx)) return null;

	const isDoubleDollar = input[startIdx + 1] === "$";
	const openDelimiterLength = isDoubleDollar ? 2 : 1;
	const closeIdx = findInlineMathEnd(input, startIdx + openDelimiterLength, isDoubleDollar);
	if (closeIdx === -1) return null;

	const contentStart = startIdx + openDelimiterLength;
	const latex = input.slice(contentStart, closeIdx);
	const closeDelimiterLength = isDoubleDollar ? 2 : 1;
	const placeholder = `ANKILINK_MATH_${placeholderCounter}_TOKEN`;
	return {
		placeholder,
		replacement: MATH_INLINE_OPEN + latex + MATH_INLINE_CLOSE,
		length: closeIdx + closeDelimiterLength - startIdx,
		nextPlaceholderCounter: placeholderCounter + 1,
	};
}

function countSameCharRun(input: string, startIdx: number, char: string): number {
	let runLength = 0;
	for (let i = startIdx; i < input.length; i++) {
		if (input[i] !== char) break;
		runLength++;
	}
	return runLength;
}

function findMatchingTickRun(input: string, startIdx: number, tickRunLength: number): number {
	let i = startIdx;
	while (i < input.length) {
		if (input[i] !== "`" || isEscaped(input, i)) {
			i++;
			continue;
		}
		if (countSameCharRun(input, i, "`") === tickRunLength) {
			return i;
		}
		i++;
	}
	return -1;
}

function findInlineMathEnd(input: string, startIdx: number, isDoubleDollar: boolean): number {
	for (let i = startIdx; i < input.length; i++) {
		if (input[i] !== "$") continue;
		if (isEscaped(input, i)) continue;
		if (isDoubleDollar) {
			if (input[i + 1] === "$") return i;
			continue;
		}
		if (input[i + 1] === "$") continue;
		return i;
	}
	return -1;
}

function isEscaped(input: string, idx: number): boolean {
	let backslashes = 0;
	for (let i = idx - 1; i >= 0 && input[i] === "\\"; i--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

function escapeHtml(value: string): string {
	return value
		.split("&").join("&amp;")
		.split("<").join("&lt;")
		.split(">").join("&gt;");
}

function escapeHtmlAttribute(value: string): string {
	return value
		.split("&").join("&amp;")
		.split("\"").join("&quot;")
		.split("<").join("&lt;")
		.split(">").join("&gt;");
}

function parseBody(lines: string[]) {
	const bodyLines: string[] = [];
	for (const line of lines) {
		// Stop early if we reach another flashcard preamble.
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

async function getDeckNameForFile(app: App, file: TFile): Promise<string | undefined> {
	let deckName: string | undefined;
	try {
		await app.fileManager.processFrontMatter(file, (frontMatter) => {
			const metadata = frontMatter as Record<string, unknown>;
			const configuredDeck = metadata["anki deck"];
			deckName = typeof configuredDeck === "string" && configuredDeck.trim().length > 0
				? configuredDeck.trim()
				: undefined;
		});
		return deckName;
	} catch {
		return undefined;
	}
}
