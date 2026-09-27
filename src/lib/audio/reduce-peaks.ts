export function chooseBuckets(sampleCount: number): number {
	if (sampleCount <= 0) return 0;
	return Math.min(1600, Math.max(200, Math.floor(sampleCount / 800)));
}

export function reducePeaks(
	channels: ArrayLike<number>[],
	buckets: number
): { min: Float32Array; max: Float32Array } {
	const length = channels[0]?.length ?? 0;
	const min = new Float32Array(buckets);
	const max = new Float32Array(buckets);
	if (length === 0 || buckets === 0) return { min, max };

	const samplesPerBucket = length / buckets;
	const stride = Math.max(1, Math.floor(samplesPerBucket / 256));

	for (let i = 0; i < buckets; i += 1) {
		let lo = 0;
		let hi = 0;
		const start = Math.floor(i * samplesPerBucket);
		const end = Math.max(start + 1, Math.min(length, Math.floor((i + 1) * samplesPerBucket)));
		for (let s = start; s < end; s += stride) {
			for (let c = 0; c < channels.length; c += 1) {
				const value = channels[c][s];
				if (value < lo) lo = value;
				if (value > hi) hi = value;
			}
		}
		min[i] = lo;
		max[i] = hi;
	}

	return { min, max };
}
