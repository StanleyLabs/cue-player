export type EndBehavior = 'playThrough' | 'stopAtCue';

export interface Cue {
	id: string;
	name: string;
	time: number;
	color: string;
	createdAt: string;
	updatedAt: string;
}

export interface Piece {
	id: string;
	fileHash: string;
	fileName: string;
	fileSize: number;
	title: string;
	duration: number;
	rate: number;
	loopEnabled: boolean;
	loopStart: number;
	loopEnd: number;
	endBehavior: EndBehavior;
	cues: Cue[];
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface LibraryData {
	version: 1;
	pieces: Piece[];
}

export interface BackupFile {
	kind: 'cue-player-backup';
	version: 1;
	exportedAt: string;
	pieces: Piece[];
}

export const BACKUP_KIND = 'cue-player-backup' as const;
export const LIBRARY_VERSION = 1 as const;
