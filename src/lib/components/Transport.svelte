<script lang="ts">
	import type { EndBehavior } from '$lib/storage/types';
	import { Play, Pause, SkipBack, SkipForward, Repeat, Gauge } from '@lucide/svelte';

	const rates = [0.5, 0.75, 1, 1.25, 1.5];

	function formatRate(value: number): string {
		const rounded = Math.round(value * 100) / 100;
		return `${rounded}×`;
	}

	function matchesRate(value: number): boolean {
		return Math.abs(rate - value) < 0.001;
	}

	let {
		playing,
		rate,
		loopEnabled,
		endBehavior,
		canPlay,
		hasPrevious,
		hasNext,
		currentTime,
		duration,
		onTogglePlay,
		onPrevious,
		onNext,
		onRate,
		onToggleLoop,
		onEndBehavior,
		onScrub,
		onScrubEnd
	}: {
		playing: boolean;
		rate: number;
		loopEnabled: boolean;
		endBehavior: EndBehavior;
		canPlay: boolean;
		hasPrevious: boolean;
		hasNext: boolean;
		currentTime: number;
		duration: number;
		onTogglePlay: () => void;
		onPrevious: () => void;
		onNext: () => void;
		onRate: (rate: number) => void;
		onToggleLoop: () => void;
		onEndBehavior: (behavior: EndBehavior) => void;
		onScrub: (time: number) => void;
		onScrubEnd: () => void;
	} = $props();

	let showSpeedSlider = $state(false);
	let speedButton: HTMLElement;
	let speedPopup = $state<HTMLElement>();

	// Seek bar state. The track element gives us the geometry; the surrounding
	// container is the (larger) interactive surface.
	let seekTrack = $state<HTMLElement | null>(null);
	let isDragging = $state(false);

	// Close popup when clicking outside
	$effect(() => {
		if (!showSpeedSlider) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			const clickedOnButton = speedButton && speedButton.contains(target);
			const clickedOnPopup = speedPopup && speedPopup.contains(target);
			
			if (!clickedOnButton && !clickedOnPopup) {
				showSpeedSlider = false;
			}
		};

		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	// Seek bar. Same model as scrubbing the waveform: capture the pointer on
	// press, scrub on every move, end the scrub on release. The engine updates
	// currentTime synchronously on each scrub, so the fill/handle follow it.
	function timeFromPointer(clientX: number): number {
		if (!seekTrack || duration <= 0) return 0;
		const rect = seekTrack.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return ratio * duration;
	}

	function onSeekDown(event: PointerEvent) {
		if (!canPlay || duration <= 0 || event.button !== 0) return;
		const surface = event.currentTarget as HTMLElement;
		surface.setPointerCapture(event.pointerId);
		isDragging = true;
		onScrub(timeFromPointer(event.clientX));
	}

	function onSeekMove(event: PointerEvent) {
		const surface = event.currentTarget as HTMLElement;
		if (!surface.hasPointerCapture(event.pointerId)) return;
		onScrub(timeFromPointer(event.clientX));
	}

	function onSeekUp(event: PointerEvent) {
		const surface = event.currentTarget as HTMLElement;
		if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
		if (!isDragging) return;
		// Always close out the scrub so the engine never stays in scrub mode.
		isDragging = false;
		onScrubEnd();
	}

	function onSeekKey(event: KeyboardEvent) {
		if (!canPlay || duration <= 0) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 0.1;
		const next = currentTime + (event.key === 'ArrowLeft' ? -step : step);
		onScrub(Math.max(0, Math.min(duration, next)));
		onScrubEnd();
	}
</script>

<footer class="transport" class:speed-open={showSpeedSlider}>
	<!-- Progress Bar -->
	<div
		class="progress-container"
		class:disabled={!canPlay || duration <= 0}
		role="slider"
		aria-label="Seek position"
		aria-valuemin={0}
		aria-valuemax={duration}
		aria-valuenow={currentTime}
		aria-disabled={!canPlay || duration <= 0}
		tabindex="0"
		onpointerdown={onSeekDown}
		onpointermove={onSeekMove}
		onpointerup={onSeekUp}
		onpointercancel={onSeekUp}
		onkeydown={onSeekKey}
	>
		<div class="progress-bar" bind:this={seekTrack}>
			<div
				class="progress-fill"
				style:width="{duration > 0 ? (currentTime / duration) * 100 : 0}%"
			></div>
			<div
				class="progress-handle"
				class:dragging={isDragging}
				style:left="{duration > 0 ? (currentTime / duration) * 100 : 0}%"
			></div>
		</div>
	</div>
	
	<div class="main-controls">
		<div class="control-row">
			<!-- Speed Button -->
			<div class="speed-section">
				<div class="speed-button-container">
					<button 
						type="button" 
						class="control-btn speed-btn" 
						class:active={!matchesRate(1)}
						bind:this={speedButton}
						onclick={() => (showSpeedSlider = !showSpeedSlider)}
						title="Speed: {formatRate(rate)}"
					>
						<Gauge size={18} />
					</button>
					<div class="speed-display">{formatRate(rate)}</div>
				</div>
				{#if showSpeedSlider}
					<div class="speed-slider-popup" bind:this={speedPopup}>
						<input
							type="range"
							min="0.5"
							max="1.5"
							step="0.05"
							aria-label="Playback speed"
							value={rate}
							style:--fill="{(rate - 0.5) * 100}%"
							oninput={(event) => onRate(Number(event.currentTarget.value))}
						/>
						<div class="speed-presets">
							{#each rates as value (value)}
								<button
									type="button"
									class="preset-btn"
									class:active={matchesRate(value)}
									onclick={() => onRate(value)}
								>
									{value}×
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Playback Controls -->
			<div class="playback-controls">
				<button type="button" class="step-btn" aria-label="Previous cue" disabled={!hasPrevious} onclick={onPrevious}>
					<SkipBack size={20} class="filled-icon" />
				</button>
				
				<button
					type="button"
					class="play-btn"
					aria-label={playing ? 'Pause' : 'Play'}
					disabled={!canPlay}
					onclick={onTogglePlay}
				>
					{#if playing}
						<Pause size={24} class="filled-icon" />
					{:else}
						<Play size={24} class="filled-icon" />
					{/if}
				</button>

				<button type="button" class="step-btn" aria-label="Next cue" disabled={!hasNext} onclick={onNext}>
					<SkipForward size={20} class="filled-icon" />
				</button>
			</div>

			<!-- Loop Button -->
			<div class="loop-section">
				<button 
					type="button" 
					class="control-btn loop-btn" 
					class:active={loopEnabled} 
					onclick={onToggleLoop}
					title="Loop"
				>
					<Repeat size={18} />
				</button>
			</div>
		</div>

		<!-- End Behavior Controls -->
		<div class="behavior-controls">
			<div class="segment-control">
				<button
					type="button"
					class="segment-btn"
					class:active={endBehavior === 'playThrough'}
					onclick={() => onEndBehavior('playThrough')}
				>
					Play through
				</button>
				<button
					type="button"
					class="segment-btn"
					class:active={endBehavior === 'stopAtCue'}
					onclick={() => onEndBehavior('stopAtCue')}
				>
					Stop at cue
				</button>
			</div>
		</div>
	</div>

</footer>

<style>
	.transport {
		/* Anchored to the .player shell, not the viewport (see .player). */
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 12px 20px calc(16px + var(--safe-bottom));
		background: rgba(18, 17, 14, 0.95);
		backdrop-filter: blur(20px);
		z-index: 10;
	}

	/* backdrop-filter creates a stacking context, so the popup's own z-index
	   cannot escape the bar. Lift the bar above the cue list while open. */
	.transport.speed-open {
		z-index: 25;
	}

	.progress-container {
		/* The whole container is the seek surface. Negative margins keep the
		   layout footprint at 24px while the touch target grows to ~42px. */
		margin: -10px 0 -8px;
		padding: 22px 0 16px;
		cursor: pointer;
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
	}

	.progress-container.disabled {
		cursor: default;
	}

	.progress-container:focus-visible {
		outline: none;
	}

	.progress-container:focus-visible .progress-bar {
		outline: 2px solid var(--accent);
		outline-offset: 6px;
		border-radius: 2px;
	}

	.progress-bar {
		position: relative;
		height: 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		pointer-events: none;
	}

	.progress-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: linear-gradient(90deg, var(--accent) 0%, var(--accent-light) 100%);
		border-radius: 2px;
		pointer-events: none;
	}

	.progress-handle {
		position: absolute;
		top: 50%;
		width: 16px;
		height: 16px;
		background: #fff;
		border: 2px solid var(--accent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		pointer-events: none;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.progress-container:hover:not(.disabled) .progress-handle {
		transform: translate(-50%, -50%) scale(1.1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	.progress-container:not(.disabled):active {
		cursor: grabbing;
	}

	.progress-handle.dragging,
	.progress-container:hover:not(.disabled) .progress-handle.dragging {
		transform: translate(-50%, -50%) scale(1.2);
	}

	.main-controls {
		padding: 16px 0 0;
	}


	.main-controls {
		max-width: 800px;
		margin: 0 auto;
	}

	.control-row {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 20px;
		margin-bottom: 16px;
	}

	.speed-section {
		position: relative;
		display: flex;
		justify-content: flex-start;
	}

	.speed-button-container {
		position: relative;
		display: inline-block;
	}

	.speed-display {
		position: absolute;
		top: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted);
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		white-space: nowrap;
	}

	.playback-controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.loop-section {
		display: flex;
		justify-content: flex-end;
	}

	.control-btn {
		min-width: 48px;
		height: 48px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
		font-weight: 600;
		font-size: 0.9rem;
		transition: all 0.2s ease;
		padding: 0 12px;
	}

	@media (hover: hover) {
		.control-btn:hover {
			background: rgba(255, 255, 255, 0.12);
			transform: translateY(-1px);
		}
	}

	.control-btn:active {
		transform: scale(0.94);
		transition: none;
	}

	/* Ensure speed button keeps pointer cursor even when popup is open */
	.speed-btn {
		cursor: pointer !important;
	}

	.control-btn.active {
		background: var(--accent-rgba-15);
		border-color: var(--accent-rgba-40);
		color: var(--accent);
	}

	.step-btn {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
		transition: all 0.2s ease;
	}

	@media (hover: hover) {
		.step-btn:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.12);
			transform: translateY(-1px);
		}
	}

	.step-btn:active:not(:disabled) {
		transform: scale(0.92);
		transition: none;
	}

	.step-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.play-btn {
		width: 68px;
		height: 68px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
		color: var(--accent-ink);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 8px;
		/* Animate the release only; the press itself must be instant (see :active). */
		transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 4px 16px var(--accent-rgba-30);
		border: 2px solid var(--accent-rgba-40);
	}

	@media (hover: hover) {
		.play-btn:hover:not(:disabled) {
			transform: translateY(-2px);
			box-shadow: 0 6px 20px var(--accent-rgba-40);
		}
	}

	.play-btn:active:not(:disabled) {
		transform: scale(0.92);
		box-shadow: 0 2px 8px var(--accent-rgba-30);
		transition: none;
	}

	.play-btn:disabled {
		background: rgba(255, 255, 255, 0.1);
		color: var(--muted);
		box-shadow: none;
		border-color: rgba(255, 255, 255, 0.2);
	}

	.speed-slider-popup {
		position: absolute;
		bottom: calc(100% + 12px);
		left: 0;
		background: #1c1b16;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 16px;
		padding: 16px;
		min-width: 200px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		z-index: 1000;
	}

	.speed-slider-popup input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 32px;
		background: transparent;
		cursor: pointer;
		margin-bottom: 12px;
	}

	.speed-slider-popup input[type='range']::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 999px;
		background: linear-gradient(to right, var(--accent) var(--fill), rgba(255, 255, 255, 0.2) var(--fill));
	}

	.speed-slider-popup input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 20px;
		height: 20px;
		margin-top: -8px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		transition: transform 0.15s ease;
	}

	.speed-slider-popup input[type='range']::-webkit-slider-thumb:hover {
		transform: scale(1.1);
	}

	.speed-presets {
		display: flex;
		gap: 6px;
	}

	.preset-btn {
		flex: 1;
		min-height: 32px;
		padding: 0 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text);
		font-size: 0.85rem;
		font-weight: 600;
		transition: all 0.15s ease;
	}

	.preset-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.preset-btn.active {
		background: var(--accent-rgba-20);
		border-color: var(--accent-rgba-40);
		color: var(--accent);
	}

	.behavior-controls {
		display: flex;
		justify-content: center;
	}

	.segment-control {
		display: flex;
		padding: 3px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		gap: 2px;
	}

	.segment-btn {
		padding: 8px 16px;
		border-radius: 9px;
		background: transparent;
		border: none;
		color: var(--muted);
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.2s ease;
		white-space: nowrap;
	}

	.segment-btn:hover {
		color: var(--text);
	}

	.segment-btn.active {
		background: var(--accent-rgba-15);
		color: var(--accent);
	}


	@media (max-width: 768px) {
		.control-row {
			gap: 16px;
		}

		.play-btn {
			width: 60px;
			height: 60px;
		}

		.step-btn {
			width: 48px;
			height: 48px;
		}
	}

	@media (max-width: 480px) {
		.transport {
			padding: 12px 16px calc(12px + var(--safe-bottom));
		}

		.control-row {
			gap: 12px;
			grid-template-columns: auto 1fr auto;
		}

		.speed-section, .loop-section {
			justify-content: center;
		}

		.play-btn {
			width: 56px;
			height: 56px;
			margin: 0 4px;
		}

		.step-btn {
			width: 44px;
			height: 44px;
		}

		.control-btn {
			min-width: 44px;
			height: 44px;
			font-size: 0.8rem;
		}
	}

	/* Fill the play and skip icons */
	:global(.filled-icon) {
		fill: currentColor !important;
	}

	:global(.filled-icon path) {
		fill: currentColor !important;
		stroke: currentColor !important;
		stroke-width: 1.5;
	}

	:global(.filled-icon polygon) {
		fill: currentColor !important;
		stroke: none !important;
	}

	/* Default rects (for skip button vertical lines) */
	:global(.filled-icon rect) {
		fill: none !important;
		stroke: currentColor !important;
		stroke-width: 2;
	}

	/* Pause button rects should be filled */
	:global(.play-btn .filled-icon rect) {
		fill: currentColor !important;
		stroke: none !important;
	}

	/* PWA performance optimization */
	@media (display-mode: standalone) {
		.transport {
			/* Force hardware acceleration to prevent rendering issues */
			transform: translateZ(0);
			will-change: transform;
		}
	}
</style>
