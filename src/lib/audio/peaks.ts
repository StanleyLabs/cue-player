import { chooseBuckets, reducePeaks } from '$lib/audio/reduce-peaks';
import { extractAacTrack, sniffContainer } from '$lib/audio/iso-audio';

export interface Peaks {
	duration: number;
	min: Float32Array;
	max: Float32Array;
}

/**
 * Peaks only need the amplitude envelope, so decode at a low rate to keep the
 * PCM small: a 10 minute stereo track is ~75 MB at 16 kHz versus ~210 MB at
 * 44.1 kHz. With 1600 buckets every bucket still covers hundreds of samples.
 */
const DECODE_SAMPLE_RATE = 16000;

/**
 * Containers we cannot demux are decoded whole, which loads the entire file
 * (video included) into memory. Refuse videos that would not fit.
 */
const WHOLE_FILE_VIDEO_LIMIT = 150 * 1024 * 1024;

export async function computePeaks(file: Blob): Promise<Peaks> {
	const audio = await decodeAudio(file);
	const channels: Float32Array[] = [];
	for (let i = 0; i < audio.numberOfChannels; i += 1) {
		channels.push(new Float32Array(audio.getChannelData(i)));
	}
	const buckets = chooseBuckets(channels[0]?.length ?? 0);
	const peaks = await reduceInWorker(channels, buckets).catch(() => {
		if ((channels[0]?.byteLength ?? 0) === 0) {
			throw new Error('Could not draw the waveform.');
		}
		return reducePeaks(channels, buckets);
	});
	return { duration: audio.duration, min: peaks.min, max: peaks.max };
}

async function decodeAudio(file: Blob): Promise<AudioBuffer> {
	const container = await sniffContainer(file);

	if (container === 'iso') {
		// MP4 / MOV / M4V / 3GP: read just the audio track's bytes, never the video.
		const aac = await extractAacTrack(file).catch(() => null);
		if (aac) {
			try {
				return await decodeBuffer(aac);
			} catch {
				// Unusual stream; fall through to the whole-file path below.
			}
		}
	}

	if ((container === 'iso' || container === 'matroska') && file.size > WHOLE_FILE_VIDEO_LIMIT) {
		throw new Error('This video is too large to draw a waveform from.');
	}
	return decodeBuffer(await file.arrayBuffer());
}

function decodeBuffer(encoded: ArrayBuffer): Promise<AudioBuffer> {
	// An offline context does not touch the audio hardware or session, and
	// decodeAudioData resamples to its rate for us.
	const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
	return context.decodeAudioData(encoded);
}

function reduceInWorker(
	channels: Float32Array[],
	buckets: number
): Promise<{ min: Float32Array; max: Float32Array }> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./peaks.worker.ts', import.meta.url), { type: 'module' });
		let settled = false;
		let handedOff = false;
		let timer = 0;

		const stop = (action: () => void) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			worker.terminate();
			action();
		};

		const fail = (message: string) => stop(() => reject(new Error(message)));

		timer = window.setTimeout(() => fail('Waveform worker timed out.'), handedOff ? 10000 : 2000);

		worker.onmessage = (
			event: MessageEvent<'ready' | { min: Float32Array; max: Float32Array }>
		) => {
			if (event.data === 'ready') {
				handedOff = true;
				window.clearTimeout(timer);
				timer = window.setTimeout(() => fail('Waveform worker timed out.'), 10000);
				const transfers: ArrayBuffer[] = [];
				const seen = new Set<ArrayBuffer>();
				for (const channel of channels) {
					const buffer = channel.buffer as ArrayBuffer;
					if (seen.has(buffer)) continue;
					seen.add(buffer);
					transfers.push(buffer);
				}
				worker.postMessage({ channels, buckets }, transfers);
				return;
			}
			const peaks = event.data;
			stop(() => resolve(peaks));
		};
		worker.onerror = () => fail('Waveform worker failed.');
		worker.postMessage('ready?');
	});
}
