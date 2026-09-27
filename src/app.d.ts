declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Navigator {
		audioSession?: {
			type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
		};
	}

	interface Window {
		showOpenFilePicker?: (options?: {
			multiple?: boolean;
			excludeAcceptAllOption?: boolean;
			types?: Array<{
				description?: string;
				accept: Record<string, string[]>;
			}>;
		}) => Promise<FileSystemFileHandle[]>;
	}
}

export {};
