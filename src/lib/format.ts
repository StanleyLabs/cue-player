export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function roundTime(seconds: number): number {
	if (!Number.isFinite(seconds)) return 0;
	return Math.round(seconds * 100) / 100;
}

export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	const tenths = Math.floor((seconds % 1) * 10);
	return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

export function titleFromFileName(name: string): string {
	const bare = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
	return bare || 'Untitled';
}
