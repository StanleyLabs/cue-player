const sessionFiles = new Map<string, File>();

export function rememberFile(hash: string, file: File): void {
	sessionFiles.set(hash, file);
}

export function recallFile(hash: string): File | undefined {
	return sessionFiles.get(hash);
}
