import { reducePeaks } from './reduce-peaks';

interface PeakWorkerScope {
	onmessage:
		| ((
				event: MessageEvent<'ready?' | { channels: Float32Array[]; buckets: number }>
		  ) => void)
		| null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

const worker = self as unknown as PeakWorkerScope;

worker.onmessage = (event) => {
	if (event.data === 'ready?') {
		worker.postMessage('ready');
		return;
	}
	const { channels, buckets } = event.data;
	const peaks = reducePeaks(channels, buckets);
	worker.postMessage(peaks, [peaks.min.buffer as ArrayBuffer, peaks.max.buffer as ArrayBuffer]);
};

export {};
