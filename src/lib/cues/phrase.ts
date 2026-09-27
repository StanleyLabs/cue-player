export function phraseBounds(
	time: number,
	cues: number[],
	duration: number
): { start: number; end: number } {
	const times = cues.filter((cue) => Number.isFinite(cue)).sort((a, b) => a - b);
	let start = 0;
	for (const cue of times) {
		if (cue <= time + 0.001) start = cue;
		else break;
	}
	const next = times.find((cue) => cue > start + 0.001);
	const end = next ?? (duration > 0 ? duration : Math.max(time, start));
	return { start, end };
}
