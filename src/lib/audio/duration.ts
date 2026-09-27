export function readDuration(file: Blob): Promise<number> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const audio = new Audio();
		const finish = (value: number) => {
			URL.revokeObjectURL(url);
			audio.src = '';
			resolve(Number.isFinite(value) ? value : 0);
		};
		audio.preload = 'metadata';
		audio.onloadedmetadata = () => finish(audio.duration);
		audio.onerror = () => finish(0);
		audio.src = url;
	});
}
