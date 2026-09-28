import { writable } from 'svelte/store';

interface LoadingState {
	isLoading: boolean;
	message: string;
}

function createLoadingStore() {
	const { subscribe, set } = writable<LoadingState>({
		isLoading: false,
		message: 'Loading...'
	});

	let safetyTimeout: number | undefined;

	return {
		subscribe,
		
		show(message = 'Loading...') {
			if (safetyTimeout) {
				clearTimeout(safetyTimeout);
			}

			set({
				isLoading: true,
				message
			});

			// Safety timeout: force hide after 30 seconds to prevent infinite loading
			safetyTimeout = setTimeout(() => {
				console.warn('Loading animation forcibly hidden after 30 seconds');
				this.forceHide();
			}, 30000);
		},

		hide() {
			this.forceHide();
		},

		// Force hide regardless of any pending timer
		forceHide() {
			if (safetyTimeout) {
				clearTimeout(safetyTimeout);
				safetyTimeout = undefined;
			}
			
			set({
				isLoading: false,
				message: 'Loading...'
			});
		},

		// Show loading for async operations
		async withLoading<T>(
			operation: () => Promise<T>, 
			message = 'Loading...'
		): Promise<T> {
			this.show(message);
			
			try {
				return await operation();
			} finally {
				this.hide();
			}
		},

		// Simulate slow network conditions (development only)
		async withSlowNetwork<T>(
			operation: () => Promise<T>, 
			message = 'Loading...', 
			simulatedDelay = 2000
		): Promise<T> {
			this.show(message);
			
			// In development, add artificial delay to simulate slow networks
			const isDev = import.meta.env.DEV;
			if (isDev) {
				const [result] = await Promise.all([
					operation(),
					new Promise(resolve => setTimeout(resolve, simulatedDelay))
				]);
				
				this.hide();
				return result;
			}
			
			// In production, just use normal loading
			return this.withLoading(operation, message);
		}
	};
}

export const loading = createLoadingStore();

// Helper functions for common loading scenarios
export function showAppLoading() {
	loading.show('Initializing...');
}

export function showAudioLoading() {
	loading.show('Processing audio...');
}

export function showNetworkLoading() {
	loading.show('Connecting...');
}

export function hideLoading() {
	loading.hide();
}