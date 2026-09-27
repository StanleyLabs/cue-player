const AUDIO_TYPES = [
	{
		description: 'Audio',
		accept: {
			'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm']
		}
	}
];

export type PickResult = { kind: 'file'; file: File } | { kind: 'cancel' } | { kind: 'fallback' };

export async function pickAudioFile(): Promise<PickResult> {
	if (typeof window.showOpenFilePicker !== 'function') return { kind: 'fallback' };
	try {
		const [handle] = await window.showOpenFilePicker({
			multiple: false,
			types: AUDIO_TYPES
		});
		return { kind: 'file', file: await handle.getFile() };
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'cancel' };
		return { kind: 'fallback' };
	}
}
