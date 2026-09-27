import { chooseBuckets, reducePeaks } from '$lib/audio/reduce-peaks';

export interface Peaks {
	duration: number;
	min: Float32Array;
	max: Float32Array;
}

export async function computePeaks(file: Blob): Promise<Peaks> {
	const context = new AudioContext();
	try {
		const encoded = await file.arrayBuffer();
		const audio = await context.decodeAudioData(encoded.slice(0));
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
	} finally {
		await context.close().catch(() => {});
	}
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
