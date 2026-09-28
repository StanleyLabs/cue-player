import { writable } from 'svelte/store';

interface LoadingState {
	isLoading: boolean;
	message: string;
	timeout?: number;
}

function createLoadingStore() {
	const { subscribe, set, update } = writable<LoadingState>({
		isLoading: false,
		message: 'Loading...'
	});

	let loadingTimeout: number | undefined;
	let safetyTimeout: number | undefined;

	return {
		subscribe,
		
		show(message = 'Loading...', minDuration = 500) {
			// Clear any existing timeouts
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
			}
			if (safetyTimeout) {
				clearTimeout(safetyTimeout);
			}

			set({
				isLoading: true,
				message,
				timeout: minDuration
			});

			// Ensure loading shows for at least minDuration ms to prevent flickering
			loadingTimeout = setTimeout(() => {
				update(state => ({ ...state, timeout: undefined }));
			}, minDuration);

			// Safety timeout: force hide after 30 seconds to prevent infinite loading
			safetyTimeout = setTimeout(() => {
				console.warn('Loading animation forcibly hidden after 30 seconds');
				this.forceHide();
			}, 30000);
		},

		hide() {
			update(state => {
				// If we're within the minimum duration, don't hide yet
				if (state.timeout !== undefined) {
					return state;
				}
				
				// Clear timeouts if they exist
				if (loadingTimeout) {
					clearTimeout(loadingTimeout);
					loadingTimeout = undefined;
				}
				if (safetyTimeout) {
					clearTimeout(safetyTimeout);
					safetyTimeout = undefined;
				}
				
				return {
					...state,
					isLoading: false
				};
			});
		},

		// Force hide regardless of timeout
		forceHide() {
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
				loadingTimeout = undefined;
			}
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
			message = 'Loading...', 
			minDuration = 500
		): Promise<T> {
			this.show(message, minDuration);
			
			try {
				const result = await operation();
				return result;
			} finally {
				// Add a small delay to ensure the operation appears to complete
				setTimeout(() => this.hide(), 150);
			}
		},

		// Simulate slow network conditions (development only)
		async withSlowNetwork<T>(
			operation: () => Promise<T>, 
			message = 'Loading...', 
			simulatedDelay = 2000
		): Promise<T> {
			this.show(message, 500);
			
			// In development, add artificial delay to simulate slow networks
			const isDev = import.meta.env.DEV;
			if (isDev) {
				const [result] = await Promise.all([
					operation(),
					new Promise(resolve => setTimeout(resolve, simulatedDelay))
				]);
				
				setTimeout(() => this.hide(), 150);
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
	loading.show('Initializing...', 800);
}

export function showAudioLoading() {
	loading.show('Processing audio...', 1000);
}

export function showNetworkLoading() {
	loading.show('Connecting...', 600);
}

export function hideLoading() {
	loading.hide();
}