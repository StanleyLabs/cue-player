export interface CueLayoutInput {
	id: string;
	name: string;
	time: number;
}

export interface PlacedCue {
	id: string;
	row: number;
	left: number;
	width: number;
}

const LABEL_GAP = 6;

export function labelWidth(name: string): number {
	return Math.max(76, Math.min(220, name.length * 8 + 32));
}

export function layoutCueLabels(cues: CueLayoutInput[], duration: number, width: number): PlacedCue[] {
	if (width <= 0) return [];
	const sorted = [...cues].sort((a, b) => a.time - b.time);
	const rowRight: number[] = [];
	const placed: PlacedCue[] = [];

	for (const cue of sorted) {
		const boxWidth = Math.min(width, labelWidth(cue.name));
		const center = duration > 0 ? (cue.time / duration) * width : width / 2;
		const left = Math.min(Math.max(0, center - boxWidth / 2), Math.max(0, width - boxWidth));
		let row = 0;
		while (row < rowRight.length && left < rowRight[row] + LABEL_GAP) row += 1;
		rowRight[row] = left + boxWidth;
		placed.push({ id: cue.id, row, left, width: boxWidth });
	}

	return placed;
}

export function laneHeight(placed: PlacedCue[]): number {
	if (placed.length === 0) return 0;
	const rows = placed.reduce((max, item) => Math.max(max, item.row + 1), 1);
	return rows * 48;
}
