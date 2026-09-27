import { clamp, roundTime, titleFromFileName } from '$lib/format';
import { rememberFile } from '$lib/storage/session';
import { readDuration } from '$lib/audio/duration';
import { hashFile } from '$lib/storage/hash';
import {
	BACKUP_KIND,
	LIBRARY_VERSION,
	type BackupFile,
	type Cue,
	type EndBehavior,
	type LibraryData,
	type Piece
} from '$lib/storage/types';

const STORAGE_KEY = 'cue-player.library';

function emptyLibrary(): LibraryData {
	return { version: LIBRARY_VERSION, pieces: [] };
}

function now(): string {
	return new Date().toISOString();
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeCue(value: unknown): Cue | null {
	if (!value || typeof value !== 'object') return null;
	const cue = value as Partial<Cue>;
	if (typeof cue.id !== 'string' || typeof cue.name !== 'string') return null;
	const time = asNumber(cue.time, 0);
	const stamp = now();
	return {
		id: cue.id,
		name: cue.name.trim() || 'Cue',
		time: roundTime(Math.max(0, time)),
		color: typeof cue.color === 'string' ? cue.color : '#e2ff57',
		createdAt: typeof cue.createdAt === 'string' ? cue.createdAt : stamp,
		updatedAt: typeof cue.updatedAt === 'string' ? cue.updatedAt : stamp
	};
}

function normalizePiece(value: unknown): Piece | null {
	if (!value || typeof value !== 'object') return null;
	const piece = value as Partial<Piece>;
	if (typeof piece.id !== 'string' || typeof piece.fileHash !== 'string') return null;
	const stamp = now();
	const endBehavior: EndBehavior = piece.endBehavior === 'stopAtCue' ? 'stopAtCue' : 'playThrough';
	const cues = Array.isArray(piece.cues)
		? piece.cues.flatMap((cue) => {
				const next = normalizeCue(cue);
				return next ? [next] : [];
			})
		: [];
	cues.sort((a, b) => a.time - b.time);
	return {
		id: piece.id,
		fileHash: piece.fileHash,
		fileName: typeof piece.fileName === 'string' ? piece.fileName : 'audio',
		fileSize: asNumber(piece.fileSize, 0),
		title: typeof piece.title === 'string' && piece.title.trim() ? piece.title.trim() : 'Untitled',
		duration: Math.max(0, asNumber(piece.duration, 0)),
		rate: clamp(asNumber(piece.rate, 1), 0.5, 1.5),
		loopEnabled: Boolean(piece.loopEnabled),
		loopStart: Math.max(0, asNumber(piece.loopStart, 0)),
		loopEnd: Math.max(0, asNumber(piece.loopEnd, 0)),
		endBehavior,
		cues,
		createdAt: typeof piece.createdAt === 'string' ? piece.createdAt : stamp,
		updatedAt: typeof piece.updatedAt === 'string' ? piece.updatedAt : stamp,
		deletedAt: typeof piece.deletedAt === 'string' ? piece.deletedAt : null
	};
}

export function loadLibrary(): LibraryData {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyLibrary();
		const parsed = JSON.parse(raw) as Partial<LibraryData>;
		const pieces = Array.isArray(parsed.pieces)
			? parsed.pieces.flatMap((piece) => {
					const next = normalizePiece(piece);
					return next ? [next] : [];
				})
			: [];
		return { version: LIBRARY_VERSION, pieces };
	} catch {
		return emptyLibrary();
	}
}

function saveLibrary(data: LibraryData): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		throw new Error('Could not save. Browser storage is full or blocked.');
	}
}

export function listPieces(): Piece[] {
	return loadLibrary()
		.pieces.filter((piece) => !piece.deletedAt)
		.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getPiece(id: string): Piece | null {
	return loadLibrary().pieces.find((piece) => piece.id === id && !piece.deletedAt) ?? null;
}

export function findByHash(hash: string): Piece | null {
	return loadLibrary().pieces.find((piece) => piece.fileHash === hash) ?? null;
}

export function deletePiece(id: string): void {
	const data = loadLibrary();
	const index = data.pieces.findIndex((piece) => piece.id === id && !piece.deletedAt);
	if (index < 0) return;
	const stamp = now();
	data.pieces[index] = { ...data.pieces[index], deletedAt: stamp, updatedAt: stamp };
	saveLibrary(data);
}

export function mutatePiece(id: string, updater: (piece: Piece) => Piece): Piece | null {
	const data = loadLibrary();
	const index = data.pieces.findIndex((piece) => piece.id === id && !piece.deletedAt);
	if (index < 0) return null;
	const next = updater(data.pieces[index]);
	next.updatedAt = now();
	next.cues = [...next.cues].sort((a, b) => a.time - b.time);
	data.pieces[index] = next;
	saveLibrary(data);
	return next;
}

export function createPiece(input: {
	fileHash: string;
	fileName: string;
	fileSize: number;
	title: string;
	duration: number;
}): Piece {
	const stamp = now();
	const piece: Piece = {
		id: crypto.randomUUID(),
		fileHash: input.fileHash,
		fileName: input.fileName,
		fileSize: input.fileSize,
		title: input.title,
		duration: input.duration,
		rate: 1,
		loopEnabled: false,
		loopStart: 0,
		loopEnd: 0,
		endBehavior: 'playThrough',
		cues: [],
		createdAt: stamp,
		updatedAt: stamp,
		deletedAt: null
	};
	const data = loadLibrary();
	data.pieces.push(piece);
	saveLibrary(data);
	return piece;
}

export async function openAudioFile(file: File): Promise<Piece> {
	const [fileHash, duration] = await Promise.all([hashFile(file), readDuration(file)]);
	const existing = findByHash(fileHash);
	let piece: Piece;
	if (existing && !existing.deletedAt) {
		piece =
			mutatePiece(existing.id, (current) => ({
				...current,
				fileName: file.name,
				fileSize: file.size,
				duration: duration || current.duration
			})) ?? existing;
	} else if (existing?.deletedAt) {
		const data = loadLibrary();
		const index = data.pieces.findIndex((item) => item.id === existing.id);
		const restored: Piece = {
			...existing,
			fileName: file.name,
			fileSize: file.size,
			duration: duration || existing.duration,
			deletedAt: null,
			updatedAt: now()
		};
		data.pieces[index] = restored;
		saveLibrary(data);
		piece = restored;
	} else {
		piece = createPiece({
			fileHash,
			fileName: file.name,
			fileSize: file.size,
			title: titleFromFileName(file.name),
			duration
		});
	}
	rememberFile(fileHash, file);
	return piece;
}

export function exportBackup(): BackupFile {
	return {
		kind: BACKUP_KIND,
		version: LIBRARY_VERSION,
		exportedAt: now(),
		pieces: listPieces()
	};
}

export function downloadBackup(): void {
	const json = JSON.stringify(exportBackup(), null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `cue-player-backup-${new Date().toISOString().slice(0, 10)}.json`;
	link.click();
	URL.revokeObjectURL(url);
}

export function importBackup(raw: string): { added: number; updated: number } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('That backup file is not valid JSON.');
	}
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('That backup file is empty.');
	}
	const backup = parsed as Partial<BackupFile>;
	if (backup.kind !== BACKUP_KIND || backup.version !== LIBRARY_VERSION || !Array.isArray(backup.pieces)) {
		throw new Error('That file is not a Cue Player backup.');
	}

	const data = loadLibrary();
	let added = 0;
	let updated = 0;
	for (const item of backup.pieces) {
		const incoming = normalizePiece(item);
		if (!incoming || incoming.deletedAt) continue;
		const index = data.pieces.findIndex((piece) => piece.fileHash === incoming.fileHash);
		if (index < 0) {
			data.pieces.push(incoming);
			added += 1;
			continue;
		}
		if (incoming.updatedAt > data.pieces[index].updatedAt) {
			data.pieces[index] = { ...incoming, id: data.pieces[index].id };
			updated += 1;
		}
	}
	saveLibrary(data);
	return { added, updated };
}

export async function requestPersistentStorage(): Promise<boolean> {
	if (!navigator.storage?.persist) return false;
	try {
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}
