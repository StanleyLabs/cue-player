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
	'.weba',
	'.caf',
	'.mka',
	'.wma',
	'.amr',
	'.3ga'
];

// Video containers are accepted too: <audio> and decodeAudioData both read the
// audio track and ignore the picture, so a rehearsal recording works as-is.
// On iOS this is also what makes the "Photo Library" / "Take Video" options in
// the file sheet meaningful (they can only ever hand us video).
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.3gp', '.3g2'];

export const MEDIA_ACCEPT = ['audio/*', 'video/*', ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].join(',');

const MEDIA_TYPES: { description: string; accept: Record<string, string[]> }[] = [
	{
		description: 'Audio',
		accept: { 'audio/*': AUDIO_EXTENSIONS }
	},
	{
		description: 'Video (audio track is used)',
		accept: { 'video/*': VIDEO_EXTENSIONS }
	}
];

function extensionOf(file: File): string {
	const dot = file.name.lastIndexOf('.');
	return dot === -1 ? '' : file.name.slice(dot).toLowerCase();
}

export function isMediaFile(file: File): boolean {
	if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return true;
	const extension = extensionOf(file);
	return AUDIO_EXTENSIONS.includes(extension) || VIDEO_EXTENSIONS.includes(extension);
}

export const NOT_MEDIA_MESSAGE =
	'That file is not an audio or video file. Choose an MP3, WAV, AIFF, M4A, FLAC, MP4, MOV, or similar.';

export type PickResult = { kind: 'file'; file: File } | { kind: 'cancel' } | { kind: 'fallback' };

export async function pickMediaFile(): Promise<PickResult> {
	if (typeof window.showOpenFilePicker !== 'function') return { kind: 'fallback' };
	try {
		const [handle] = await window.showOpenFilePicker({
			multiple: false,
			excludeAcceptAllOption: true,
			types: MEDIA_TYPES
		});
		return { kind: 'file', file: await handle.getFile() };
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'cancel' };
		return { kind: 'fallback' };
	}
}
