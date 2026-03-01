import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
const ANKI_CONN_URL = "http://localhost:8765"
const ANKI_CONN_METHOD = "Post"
const ANKI_CONN_VERSION = 6;

export enum DeckTypes {
	BASIC = "basic"
}

export const TARGET_DECK = "Obsidian 4"
export const ANKI_LINK_MODEL_NAME = "AnkiLink Basic";
const ANKI_LINK_CARD_NAME = "Card 1";
const ANKI_LINK_MODEL_FRONT_TEMPLATE = "<div class=\"anki-link\">{{Front}}</div>";
const ANKI_LINK_MODEL_BACK_TEMPLATE = "<div class=\"anki-link\">{{FrontSide}}<hr id=\"answer\">{{Back}}</div>";
export const DEFAULT_DECK_TYPE = ANKI_LINK_MODEL_NAME;
export const ANKI_LINK_TAG = "ankiLink"

enum ConnAction {
	CREATE_DECK = "createDeck",
	CREATE_MODEL = "createModel",
	ADD_NOTE = "addNote",
	ADD_TAGS = "addTags",
	CHANGE_DECK = "changeDeck",
	DECK_NAMES = "deckNames",
	MODEL_NAMES = "modelNames",
	UPDATE_MODEL_TEMPLATES = "updateModelTemplates",
	UPDATE_MODEL_STYLING = "updateModelStyling",
	FIND_NOTES = "findNotes",
	DELETE_NOTES = "deleteNotes",
	NOTES_INFO = "notesInfo",
	UPDATE_NOTE_FIELDS = "updateNoteFields"
}

interface ConnResult {
	error: null | string;
}

interface ConnRequest {
	action: ConnAction
	version: number
}

export interface Note {
	deckName: string,
	modelName: string,
	fields: NoteFields,
	tags: string[],
	options: {
		allowDuplicate: boolean
	}
}

export interface NoteFields {
	Front: string,
	Back: string
}

export interface DeckNamesResult extends ConnResult {
	result: string[];
}

export interface CreateDeckRequest extends ConnRequest {
	params: {
		deck: string
	}
}
export interface CreateDeckResult extends ConnResult {
	result: number;
}

export interface ModelNamesResult extends ConnResult {
	result: string[];
}

interface CardTemplate {
	Name: string;
	Front: string;
	Back: string;
}

export interface CreateModelRequest extends ConnRequest {
	params: {
		modelName: string;
		inOrderFields: string[];
		css: string;
		cardTemplates: CardTemplate[];
		isCloze: boolean;
	}
}

export interface CreateModelResult extends ConnResult {
	result: null;
}

export interface UpdateModelTemplatesRequest extends ConnRequest {
	params: {
		model: {
			name: string;
			templates: Record<string, { Front: string; Back: string }>;
		};
	}
}

export interface UpdateModelTemplatesResult extends ConnResult {
	result: null;
}

export interface UpdateModelStylingRequest extends ConnRequest {
	params: {
		model: {
			name: string;
			css: string;
		};
	}
}

export interface UpdateModelStylingResult extends ConnResult {
	result: null;
}

export interface AddNoteRequest extends ConnRequest {
	params: {
		note: Note
	}
}
export interface AddNoteResult extends ConnResult {
	result: number;
}

export interface AddTagsRequest extends ConnRequest {
	params: {
		notes: number[];
		tags: string;
	}
}
export interface AddTagsResult extends ConnResult {
	result: null;
}

export interface FindNotesRequest extends ConnRequest {
	params: {
		query: string;
	}
}
export interface FindNotesResult extends ConnResult {
	result: number[];
}

export interface DeleteNotesRequest extends ConnRequest {
	params: {
		notes: number[];
	}
}
export interface DeleteNotesResult extends ConnResult {
	result: null;
}

export interface ChangeDeckRequest extends ConnRequest {
	params: {
		cards: number[];
		deck: string;
	}
}
export interface ChangeDeckResult extends ConnResult {
	result: null;
}

export interface NotesInfoRequest extends ConnRequest {
	params: {
		notes: number[];
	}
}
export interface NoteInfo {
	noteId: number;
	modelName: string;
	tags: string[];
	cards: number[];
	fields: {
		Front: { value: string; order: number };
		Back: { value: string; order: number };
	};
}
export interface NotesInfoResult extends ConnResult {
	result: unknown[];
}

/**
 * Check if a value from notesInfo is a valid note (and not an empty object
 * returned when the note was deleted in Anki).
 */
function isValidNoteInfo(obj: unknown): obj is NoteInfo {
	if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
		return false;
	}
	const o = obj as Record<string, unknown>;
	const fields = o.fields as Record<string, { value?: string }> | undefined;
	return (
		typeof o.noteId === "number" &&
		fields != null &&
		typeof fields === "object" &&
		typeof fields.Front?.value === "string" &&
		typeof fields.Back?.value === "string"
	);
}

function getFirstValidNoteInfo(result: NotesInfoResult): NoteInfo | null {
	const first = result.result[0];
	return isValidNoteInfo(first) ? first : null;
}

export async function getNoteById(noteId: number): Promise<NoteInfo | undefined> {
	const infoRes = await sendNotesInfoRequest([noteId]);
	if (infoRes.error) throw new Error(`AnkiConnect ${infoRes.error}`);
	const note = getFirstValidNoteInfo(infoRes);
	return note ?? undefined;
}

export async function updateNoteById(noteId: number, fields: NoteFields): Promise<void> {
	const updateRes = await sendUpdateNoteFieldsRequest(noteId, fields);
	if (updateRes.error) throw new Error(`AnkiConnect ${updateRes.error}`);
}

export function noteHasTag(note: NoteInfo, tag = ANKI_LINK_TAG): boolean {
	const normalizedTag = tag.toLowerCase();
	return note.tags.some((currentTag) => currentTag.toLowerCase() === normalizedTag);
}

export async function addTagToNotes(noteIds: number[], tag = ANKI_LINK_TAG): Promise<void> {
	if (noteIds.length === 0) return;
	const req: AddTagsRequest = {
		action: ConnAction.ADD_TAGS,
		version: ANKI_CONN_VERSION,
		params: {
			notes: noteIds,
			tags: tag,
		},
	};
	const res = await buildAndSend(req);
	const addTagsRes = res.json as AddTagsResult;
	if (addTagsRes.error) throw new Error(`AnkiConnect ${addTagsRes.error}`);
}

export async function findNoteIdsByTag(tag = ANKI_LINK_TAG): Promise<number[]> {
	const req: FindNotesRequest = {
		action: ConnAction.FIND_NOTES,
		version: ANKI_CONN_VERSION,
		params: {
			query: `tag:${tag}`,
		},
	};
	const res = await buildAndSend(req);
	const findNotesRes = res.json as FindNotesResult;
	if (findNotesRes.error) throw new Error(`AnkiConnect ${findNotesRes.error}`);
	return findNotesRes.result;
}

export async function findNoteIdsByTagInDeck(deckName: string, tag = ANKI_LINK_TAG): Promise<number[]> {
	const req: FindNotesRequest = {
		action: ConnAction.FIND_NOTES,
		version: ANKI_CONN_VERSION,
		params: {
			query: `tag:${tag} deck:"${escapeQueryValue(deckName)}"`,
		},
	};
	const res = await buildAndSend(req);
	const findNotesRes = res.json as FindNotesResult;
	if (findNotesRes.error) throw new Error(`AnkiConnect ${findNotesRes.error}`);
	return findNotesRes.result;
}

export async function noteIsInDeck(noteId: number, deckName: string): Promise<boolean> {
	const req: FindNotesRequest = {
		action: ConnAction.FIND_NOTES,
		version: ANKI_CONN_VERSION,
		params: {
			query: `nid:${noteId} deck:"${escapeQueryValue(deckName)}"`,
		},
	};
	const res = await buildAndSend(req);
	const findNotesRes = res.json as FindNotesResult;
	if (findNotesRes.error) throw new Error(`AnkiConnect ${findNotesRes.error}`);
	return findNotesRes.result.includes(noteId);
}

export async function moveNoteToDeck(noteId: number, deckName: string): Promise<void> {
	const note = await getNoteById(noteId);
	if (!note || !Array.isArray(note.cards) || note.cards.length === 0) {
		throw new Error(`AnkiConnect could not move note ${noteId} to deck "${deckName}"`);
	}
	const req: ChangeDeckRequest = {
		action: ConnAction.CHANGE_DECK,
		version: ANKI_CONN_VERSION,
		params: {
			cards: note.cards,
			deck: deckName,
		},
	};
	const res = await buildAndSend(req);
	const changeDeckRes = res.json as ChangeDeckResult;
	if (changeDeckRes.error) throw new Error(`AnkiConnect ${changeDeckRes.error}`);
}

export async function deleteNotesById(noteIds: number[]): Promise<void> {
	if (noteIds.length === 0) return;
	const req: DeleteNotesRequest = {
		action: ConnAction.DELETE_NOTES,
		version: ANKI_CONN_VERSION,
		params: {
			notes: noteIds,
		},
	};
	const res = await buildAndSend(req);
	const deleteNotesRes = res.json as DeleteNotesResult;
	if (deleteNotesRes.error) throw new Error(`AnkiConnect ${deleteNotesRes.error}`);
}

export interface UpdateNoteFieldsRequest extends ConnRequest {
	params: {
		note: {
			id: number;
			fields: NoteFields;
		}
	}
}
export interface UpdateNoteFieldsResult extends ConnResult {
	result: null;
}

const BASE_REQUEST = { url: ANKI_CONN_URL, method: ANKI_CONN_METHOD };

export function buildNote(Front: string, Back: string, deckName = TARGET_DECK): Note {
	return {
		deckName,
		modelName: DEFAULT_DECK_TYPE,
		fields: { Front, Back },
		tags: [ANKI_LINK_TAG],
		options: {
			allowDuplicate: true
		}
	}
}
export async function sendCreateDeckRequest(deck: string): Promise<CreateDeckResult> {
	const connReq: CreateDeckRequest = {
		action: ConnAction.CREATE_DECK,
		version: ANKI_CONN_VERSION,
		params: { deck }
	}
	const res = await buildAndSend(connReq);
	return res.json as CreateDeckResult
}

export async function sendModelNamesRequest(): Promise<ModelNamesResult> {
	const res = await buildAndSend({
		action: ConnAction.MODEL_NAMES,
		version: ANKI_CONN_VERSION
	});
	return res.json as ModelNamesResult;
}

export async function sendCreateModelRequest(modelName = ANKI_LINK_MODEL_NAME): Promise<CreateModelResult> {
	const req: CreateModelRequest = {
		action: ConnAction.CREATE_MODEL,
		version: ANKI_CONN_VERSION,
		params: {
			modelName,
			inOrderFields: ["Front", "Back"],
			css: ANKI_LINK_MODEL_CSS,
			cardTemplates: [
				{
					Name: ANKI_LINK_CARD_NAME,
					Front: ANKI_LINK_MODEL_FRONT_TEMPLATE,
					Back: ANKI_LINK_MODEL_BACK_TEMPLATE,
				},
			],
			isCloze: false,
		},
	};
	const res = await buildAndSend(req);
	return res.json as CreateModelResult;
}

export async function sendUpdateModelTemplatesRequest(modelName = ANKI_LINK_MODEL_NAME): Promise<UpdateModelTemplatesResult> {
	const templates = {
		[ANKI_LINK_CARD_NAME]: {
			Front: ANKI_LINK_MODEL_FRONT_TEMPLATE,
			Back: ANKI_LINK_MODEL_BACK_TEMPLATE,
		},
	};
	const req: UpdateModelTemplatesRequest = {
		action: ConnAction.UPDATE_MODEL_TEMPLATES,
		version: ANKI_CONN_VERSION,
		params: {
			model: {
				name: modelName,
				templates,
			},
		},
	};
	const res = await buildAndSend(req);
	return res.json as UpdateModelTemplatesResult;
}

export async function sendUpdateModelStylingRequest(modelName = ANKI_LINK_MODEL_NAME): Promise<UpdateModelStylingResult> {
	const req: UpdateModelStylingRequest = {
		action: ConnAction.UPDATE_MODEL_STYLING,
		version: ANKI_CONN_VERSION,
		params: {
			model: {
				name: modelName,
				css: ANKI_LINK_MODEL_CSS,
			},
		},
	};
	const res = await buildAndSend(req);
	return res.json as UpdateModelStylingResult;
}

export async function sendAddNoteRequest(note: Note): Promise<AddNoteResult> {
	const req: AddNoteRequest = {
		action: ConnAction.ADD_NOTE,
		version: ANKI_CONN_VERSION,
		params: { note }
	}
	const res = await buildAndSend(req);
	return res.json as AddNoteResult
}

export async function sendNotesInfoRequest(notes: number[]): Promise<NotesInfoResult> {
	const req: NotesInfoRequest = {
		action: ConnAction.NOTES_INFO,
		version: ANKI_CONN_VERSION,
		params: { notes }
	}
	const res = await buildAndSend(req);
	return res.json as NotesInfoResult;
}

export async function sendUpdateNoteFieldsRequest(id: number, fields: NoteFields): Promise<UpdateNoteFieldsResult> {
	const req: UpdateNoteFieldsRequest = {
		action: ConnAction.UPDATE_NOTE_FIELDS,
		version: ANKI_CONN_VERSION,
		params: { note: { id, fields } }
	}
	const res = await buildAndSend(req);
	return res.json as UpdateNoteFieldsResult;
}

export async function sendDeckNamesRequest(): Promise<DeckNamesResult> {
	const res = await buildAndSend({
		action: ConnAction.DECK_NAMES,
		version: ANKI_CONN_VERSION
	});
	return res.json as DeckNamesResult
}

export function buildDeckNamesRequest(): RequestUrlParam {
	return build({ action: ConnAction.DECK_NAMES, version: ANKI_CONN_VERSION });
}

async function buildAndSend(req: ConnRequest): Promise<RequestUrlResponse> {
	return await requestUrl(build(req));
}

function build(action: ConnRequest): RequestUrlParam {
	return { ...BASE_REQUEST, body: JSON.stringify(action) };
}

function escapeQueryValue(value: string): string {
	return value.split("\"").join(String.raw`\"`);
}

const ANKI_LINK_MODEL_CSS = `
.anki-link {
  max-width: min(72ch, 100%);
  margin: 0 auto;
  text-align: left;
}

.anki-link pre {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 0.75em 1em;
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre;
  line-height: 1.4;
}

.anki-link code {
  font-family: "JetBrains Mono", "Fira Code", "Menlo", monospace;
  font-size: 0.9em;
}

.anki-link :not(pre) > code {
  background: #f3f3f3;
  color: #222;
  padding: 0.1em 0.3em;
  border-radius: 4px;
}
`.trim();
