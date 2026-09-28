<script lang="ts">
	import { loading } from '$lib/stores/loading';
	
	let { 
		message = "Loading ...",
		show = true,
		allowDismiss = true
	}: {
		message?: string;
		show?: boolean;
		allowDismiss?: boolean;
	} = $props();

	// Simple loading dots animation

	function handleKeydown(event: KeyboardEvent) {
		if (allowDismiss && event.key === 'Escape') {
			loading.forceHide();
		}
	}

	let clickCount = 0;

	function handleDismiss() {
		if (allowDismiss) {
			clickCount++;
			if (clickCount === 1) {
				// Single click - try normal hide
				loading.hide();
				setTimeout(() => clickCount = 0, 1000);
			} else {
				// Double click - force hide immediately
				loading.forceHide();
				clickCount = 0;
			}
		}
	}
</script>

{#if show}
	<div 
		class="loading-indicator" 
		role="status" 
		aria-label={message}
		onclick={allowDismiss ? handleDismiss : undefined}
		onkeydown={handleKeydown}
		tabindex={allowDismiss ? 0 : -1}
		title={message}
	>
		<div class="loading-icon">
			<svg class="waveform-svg" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="white" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
				<!-- Individual animated waveform bars -->
				<rect class="wave-bar" x="2" y="20" width="8" height="8" fill="white" rx="1" style:--delay="0.1s" />
				<rect class="wave-bar" x="14" y="20" width="8" height="8" fill="white" rx="1" style:--delay="0.2s" />
				<rect class="wave-bar" x="26" y="20" width="8" height="8" fill="white" rx="1" style:--delay="0.3s" />
				<rect class="wave-bar" x="38" y="20" width="8" height="8" fill="white" rx="1" style:--delay="0.4s" />
			</svg>
		</div>
	</div>
{/if}

<style>
	.loading-indicator {
		position: fixed;
		bottom: 18px;
		right: 40px;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		align-items: end;
		gap: 6px;
		pointer-events: none;
		animation: fade-in 0.4s ease-out;
	}

	.loading-indicator[tabindex="0"] {
		pointer-events: auto;
		cursor: pointer;
	}

	.loading-icon {
		display: flex;
		align-items: center;
		justify-content: right;
	}

	.waveform-svg {
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
	}

	.wave-bar {
		animation: wave-bounce 1.2s ease-in-out infinite;
		animation-delay: var(--delay);
		transform-origin: center center;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.9);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes wave-bounce {
		0%, 60%, 100% {
			opacity: 0.2;
			transform: scaleY(1)
		}
		30% {
			opacity: 1;
			transform: scaleY(4)
		}
	}

	/* Mobile adjustments */
	@media (max-width: 480px) {
		.loading-indicator {
			bottom: 18px;
			right: 28px;
		}

		.waveform-svg {
			width: 40px;
			height: 40px;
		}
	}

	/* Reduce motion for accessibility */
	@media (prefers-reduced-motion: reduce) {
		.wave-bar {
			animation: wave-fade 2s ease-in-out infinite;
		}

		.loading-indicator {
			animation: fade-in-reduced 0.2s ease-out;
		}
	}

	@keyframes wave-fade {
		0%, 100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}

	@keyframes fade-in-reduced {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* High contrast mode support */
	@media (prefers-contrast: high) {
		.waveform-svg {
			stroke: white;
			filter: none;
		}
	}
</style>