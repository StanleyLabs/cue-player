const AUDIO_EXTENSIONS = [
	'.mp3',
	'.mpga',
	'.wav',
	'.wave',
	'.aif',
	'.aiff',
	'.aifc',
	'.m4a',
	'.m4b',
	'.aac',
	'.adts',
	'.ogg',
	'.oga',
	'.opus',
	'.flac',
	'.webm',
	'.weba',
	'.caf',
	'.mka',
	'.wma',
	'.amr',
	'.3ga'
];

export const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTENSIONS].join(',');

const AUDIO_TYPES = [
	{
		description: 'Audio',
		accept: {
			'audio/*': AUDIO_EXTENSIONS
		}
	}
];

export function isAudioFile(file: File): boolean {
	if (file.type.startsWith('audio/')) return true;
	const dot = file.name.lastIndexOf('.');
	return dot !== -1 && AUDIO_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}

export const NOT_AUDIO_MESSAGE = 'That file is not an audio file. Choose an MP3, WAV, AIFF, M4A, FLAC, OGG, or similar.';

export type PickResult = { kind: 'file'; file: File } | { kind: 'cancel' } | { kind: 'fallback' };

export async function pickAudioFile(): Promise<PickResult> {
	if (typeof window.showOpenFilePicker !== 'function') return { kind: 'fallback' };
	try {
		const [handle] = await window.showOpenFilePicker({
			multiple: false,
			excludeAcceptAllOption: true,
			types: AUDIO_TYPES
		});
		return { kind: 'file', file: await handle.getFile() };
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'cancel' };
		return { kind: 'fallback' };
	}
}
