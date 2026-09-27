export const CUE_COLORS = ['#e2ff57', '#8eb6ff', '#ffb020', '#ff8ad4', '#5ee0c2'] as const;

export function nextCueColor(count: number): string {
	return CUE_COLORS[count % CUE_COLORS.length];
}

export function smartCueColor(existingCues: { time: number; color: string }[], newTime: number): string {
	// Count how many times each color has been used to ensure equal distribution
	const colorUsage = new Map<string, number>();
	CUE_COLORS.forEach(color => colorUsage.set(color, 0));
	
	existingCues.forEach(cue => {
		if (CUE_COLORS.includes(cue.color as any)) {
			colorUsage.set(cue.color, (colorUsage.get(cue.color) || 0) + 1);
		}
	});
	
	// Find the minimum usage count to identify least-used colors
	const minUsage = Math.min(...Array.from(colorUsage.values()));
	const leastUsedColors = CUE_COLORS.filter(color => colorUsage.get(color) === minUsage);
	
	// Sort existing cues by time to find spatial neighbors
	const sortedByTime = [...existingCues].sort((a, b) => a.time - b.time);
	
	// Find colors to avoid due to proximity (smart selection rules)
	const nearbyColors = new Set<string>();
	
	// Find the immediate previous cue (most important to avoid)
	let previousCue = null;
	for (const cue of sortedByTime) {
		if (cue.time < newTime) {
			previousCue = cue;
		} else {
			break;
		}
	}
	
	// Always avoid the previous cue's color
	if (previousCue) {
		nearbyColors.add(previousCue.color);
	}
	
	// Also avoid colors of cues within 10 seconds
	for (let i = 0; i < sortedByTime.length; i++) {
		const cue = sortedByTime[i];
		if (Math.abs(cue.time - newTime) < 10) { // Within 10 seconds
			nearbyColors.add(cue.color);
			// Also add colors of immediate neighbors in the timeline
			if (i > 0) nearbyColors.add(sortedByTime[i - 1].color);
			if (i < sortedByTime.length - 1) nearbyColors.add(sortedByTime[i + 1].color);
		}
	}
	
	// First, try least-used colors that pass smart selection
	const validLeastUsed = leastUsedColors.filter(color => !nearbyColors.has(color));
	if (validLeastUsed.length > 0) {
		// If multiple least-used colors are valid, pick randomly to avoid order bias
		return validLeastUsed[Math.floor(Math.random() * validLeastUsed.length)];
	}
	
	// If no least-used colors work, try all colors that pass smart selection
	const validColors = CUE_COLORS.filter(color => !nearbyColors.has(color));
	if (validColors.length > 0) {
		// Pick randomly from valid colors to ensure equal distribution over time
		return validColors[Math.floor(Math.random() * validColors.length)];
	}
	
	// If all colors fail smart selection, pick the least-used color anyway
	return leastUsedColors[Math.floor(Math.random() * leastUsedColors.length)];
}

export function nextCueName(cues: { name: string }[]): string {
	let max = 0;
	for (const cue of cues) {
		const match = /^Cue (\d+)$/.exec(cue.name);
		if (match) max = Math.max(max, Number(match[1]));
	}
	return `Cue ${max + 1}`;
}
