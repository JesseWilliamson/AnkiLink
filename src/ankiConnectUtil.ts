import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
const ANKI_CONN_URL = "http://localhost:8765"
const ANKI_CONN_METHOD = "Post"
const ANKI_CONN_VERSION = 6;

export enum DeckTypes {
	BASIC = "basic"
}

export const TARGET_DECK = "Obsidian 4"
export const DEFAULT_DECK_TYPE = DeckTypes.BASIC

enum ConnAction {
	CREATE_DECK = "createDeck",
	ADD_NOTE = "addNote",
	DECK_NAMES = "deckNames",
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

export interface AddNoteRequest extends ConnRequest {
	params: {
		note: Note
	}
}
export interface AddNoteResult extends ConnResult {
	result: number;
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

export function buildNote(Front: string, Back: string): Note {
	return {
		deckName: TARGET_DECK,
		modelName: DEFAULT_DECK_TYPE,
		fields: { Front, Back },
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
