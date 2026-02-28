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
}

interface ConnResult {
	error: null | string;
}

interface ConnRequest {
	action: ConnAction
	version: number
}

export interface ConnNote {
	deckName: string,
	modelName: string,
	fields: ConnNoteFields
}

export interface ConnNoteFields {
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
		note: ConnNote
	}
}
export interface AddNoteResult extends ConnResult {
	result: number;
}

const BASE_REQUEST = { url: ANKI_CONN_URL, method: ANKI_CONN_METHOD };

export function buildNote(Front: string, Back: string): ConnNote {
	return {
		deckName: TARGET_DECK,
		modelName: DEFAULT_DECK_TYPE,
		fields: { Front, Back }
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

export async function sendAddNoteRequest(note: ConnNote): Promise<AddNoteResult> {
	const req: AddNoteRequest = {
		action: ConnAction.ADD_NOTE,
		version: ANKI_CONN_VERSION,
		params: { note }
	}
	const res = await buildAndSend(req);
	return res.json as CreateDeckResult
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
