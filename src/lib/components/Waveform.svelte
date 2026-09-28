<script lang="ts">
	import { clamp } from '$lib/format';
	import type { Peaks } from '$lib/audio/peaks';
	import type { Cue } from '$lib/storage/types';
	import { ZoomIn, ZoomOut } from '@lucide/svelte';

	let {
		peaks,
		duration,
		currentTime,
		cues,
		loopEnabled,
		loopStart,
		loopEnd,
		onscrub,
		onscrubend,
		onmove
	}: {
		peaks: Peaks | null;
		duration: number;
		currentTime: number;
		cues: Cue[];
		loopEnabled: boolean;
		loopStart: number;
		loopEnd: number;
		onscrub: (time: number) => void;
		onscrubend: () => void;
		onmove?: (id: string, time: number) => void;
	} = $props();

	// Zoom and pan state
	let zoomLevel = $state(1);
	let panOffset = $state(0); // Time offset in seconds
	let isDragging = $state(false);
	let lastDragX = $state(0);
	let panBarDragging = $state(false);
	let panBarStartX = $state(0); // Initial mouse X position
	let panBarStartOffset = $state(0); // Initial pan offset when drag started
	
	// Touch gesture state
	let touchStartDistance = $state(0);
	let touchStartZoom = $state(1);
	// Audio time under the pinch midpoint when the gesture began. Zoom and pan
	// keep this time under the midpoint so the waveform stays on the fingers.
	let pinchFocalTime = 0;
	let activeTouches = $state(0);
	let followPlayhead = $state(false);
	// A two-finger gesture only zooms and pans. Playhead seeks stay on a one-finger drag.
	let pinching = $state(false);
	let touchPointerIds = new Set<number>();
	let scrubPointerId: number | null = null;
	let scrubOriginX = 0;
	let scrubOriginY = 0;
	let scrubbedDuringGesture = false;
	let timeBeforeScrub = 0;
	// Set when a second finger touches, so a pointerdown in that same gesture
	// stays a pinch. Cleared when every finger lifts.
	let multiTouchAt = 0;
	let singleTouchAt = 0;
	
	// Cue dragging state
	let draggedCue = $state<string | null>(null);
	let dragStartX = $state(0);
	let dragStartTime = $state(0);

	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const observer = new ResizeObserver(() => draw());
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		peaks;
		duration;
		currentTime;
		cues;
		loopEnabled;
		loopStart;
		loopEnd;
		draw();
	});

	// Calculate visible time range based on zoom and pan
	const visibleDuration = $derived(duration / zoomLevel);
	const visibleStart = $derived(clamp(panOffset, 0, duration - visibleDuration));
	const visibleEnd = $derived(visibleStart + visibleDuration);
	const playheadRatio = $derived(
		duration > 0 && visibleDuration > 0 ? (currentTime - visibleStart) / visibleDuration : null
	);

	// Follow playhead when enabled - always center it. Pause only while two
	// fingers are actually down; a leftover pinch flag must not freeze follow.
	$effect(() => {
		const time = currentTime;
		const visible = visibleDuration;
		if (!followPlayhead || zoomLevel <= 1 || isDragging || panBarDragging || activeTouches > 1) return;

		const targetPanOffset = time - visible / 2;
		panOffset = clamp(targetPanOffset, 0, Math.max(0, duration - visible));
	});

	function draw() {
		const el = canvas;
		if (!el) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const width = el.clientWidth;
		const height = el.clientHeight;
		if (width === 0 || height === 0) return;
		const bitmapWidth = Math.floor(width * dpr);
		const bitmapHeight = Math.floor(height * dpr);
		if (el.width !== bitmapWidth || el.height !== bitmapHeight) {
			el.width = bitmapWidth;
			el.height = bitmapHeight;
		}
		const ctx = el.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);

		// Draw loop region (adjusted for zoom/pan)
		if (loopEnabled && duration > 0 && visibleDuration > 0) {
			const x1 = Math.max(0, ((loopStart - visibleStart) / visibleDuration) * width);
			const x2 = Math.min(width, ((loopEnd - visibleStart) / visibleDuration) * width);
			if (x2 > x1) {
				ctx.fillStyle = 'rgba(226, 255, 87, 0.16)';
				ctx.fillRect(x1, 0, x2 - x1, height);
			}
		}

		// Draw center line
		const mid = height / 2;
		ctx.fillStyle = 'rgba(246, 241, 230, 0.16)';
		ctx.fillRect(0, mid - 1, width, 2);

		// Draw waveform (adjusted for zoom/pan)
		if (peaks && peaks.max.length > 0 && visibleDuration > 0) {
			const buckets = peaks.max.length;
			const startBucket = Math.floor((visibleStart / duration) * buckets);
			const endBucket = Math.ceil((visibleEnd / duration) * buckets);
			
			ctx.beginPath();
			for (let i = startBucket; i <= endBucket && i < buckets; i += 1) {
				const time = (i / (buckets - 1)) * duration;
				const x = ((time - visibleStart) / visibleDuration) * width;
				const y = mid - peaks.max[i] * (mid - 8);
				if (i === startBucket) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			for (let i = endBucket; i >= startBucket && i >= 0; i -= 1) {
				const time = (i / (buckets - 1)) * duration;
				const x = ((time - visibleStart) / visibleDuration) * width;
				const y = mid - peaks.min[i] * (mid - 8);
				ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.fillStyle = '#f6f1e6';
			ctx.globalAlpha = 0.9;
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		// Draw cue markers (adjusted for zoom/pan)
		for (const cue of cues) {
			if (duration <= 0 || visibleDuration <= 0) continue;
			if (cue.time < visibleStart || cue.time > visibleEnd) continue;
			const x = ((cue.time - visibleStart) / visibleDuration) * width;
			ctx.fillStyle = cue.color;
			ctx.fillRect(x - 1, 0, 2, height);
		}

		// Draw playhead (adjusted for zoom/pan). The triangle sits above the
		// canvas so the rounded waveform edge does not clip it.
		if (duration > 0 && visibleDuration > 0) {
			if (currentTime >= visibleStart && currentTime <= visibleEnd) {
				const x = ((currentTime - visibleStart) / visibleDuration) * width;
				ctx.fillStyle = '#fff';
				ctx.fillRect(x - 1.5, 0, 3, height);
			}
		}
	}

	function timeFromPointer(event: PointerEvent): number {
		const rect = canvas?.getBoundingClientRect();
		if (!rect || visibleDuration <= 0) return 0;
		const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
		return visibleStart + ratio * visibleDuration;
	}

	const TOUCH_SCRUB_SLOP = 8;

	function releaseScrubPointer() {
		if (scrubPointerId != null && canvas?.hasPointerCapture(scrubPointerId)) {
			canvas.releasePointerCapture(scrubPointerId);
		}
		scrubPointerId = null;
	}

	function beginPinch() {
		// Mark the pinch before restoring, so follow-playhead does not chase a seek
		// the second finger is about to undo.
		pinching = true;
		if (scrubbedDuringGesture) {
			// The first finger may have already seeked before the second landed.
			onscrub(timeBeforeScrub);
			onscrubend();
			scrubbedDuringGesture = false;
		}
		releaseScrubPointer();
	}

	function onPointerDown(event: PointerEvent) {
		if (duration <= 0 || !canvas) return;

		if (event.pointerType === 'touch') {
			const now = performance.now();
			const concurrentPinch = now - multiTouchAt < 80 && multiTouchAt >= singleTouchAt;
			const singleFinger = now - singleTouchAt < 80 && singleTouchAt > multiTouchAt;
			// A one-finger touch is always a scrub, even if an earlier pinch left
			// stale pointer tracking behind. A second finger in the same gesture is not.
			if (!singleFinger && (!event.isPrimary || concurrentPinch)) {
				touchPointerIds.add(event.pointerId);
				activeTouches = Math.max(activeTouches, touchPointerIds.size);
				beginPinch();
				return;
			}
			pinching = false;
			touchPointerIds.clear();
			touchPointerIds.add(event.pointerId);
			activeTouches = 1;
			timeBeforeScrub = currentTime;
			scrubbedDuringGesture = false;
			scrubOriginX = event.clientX;
			scrubOriginY = event.clientY;
			scrubPointerId = event.pointerId;
			canvas.setPointerCapture(event.pointerId);
			return;
		}
		
		// Check if this is a pan gesture (right-click, middle mouse, or shift+click)
		if (event.button === 2 || event.button === 1 || event.shiftKey) {
			event.preventDefault(); // Prevent context menu for right-click
			canvas.setPointerCapture(event.pointerId);
			isDragging = true;
			lastDragX = event.clientX;
			return;
		}

		// Regular scrubbing (left-click only)
		if (event.button === 0) {
			canvas.setPointerCapture(event.pointerId);
			onscrub(timeFromPointer(event));
		}
	}

	function onPointerMove(event: PointerEvent) {
		if (pinching) return;
		if (!canvas?.hasPointerCapture(event.pointerId)) return;
		
		if (isDragging) {
			// Pan the view
			const dx = event.clientX - lastDragX;
			const rect = canvas.getBoundingClientRect();
			const timeDelta = (-dx / rect.width) * visibleDuration;
			panOffset = clamp(panOffset + timeDelta, 0, duration - visibleDuration);
			lastDragX = event.clientX;
			return;
		}

		if (event.pointerType === 'touch') {
			if (pinching || event.pointerId !== scrubPointerId) return;
			const dx = event.clientX - scrubOriginX;
			const dy = event.clientY - scrubOriginY;
			if (!scrubbedDuringGesture && dx * dx + dy * dy < TOUCH_SCRUB_SLOP * TOUCH_SCRUB_SLOP) return;
			scrubbedDuringGesture = true;
		}

		onscrub(timeFromPointer(event));
	}

	function onPointerUp(event: PointerEvent) {
		if (event.pointerType === 'touch') {
			touchPointerIds.delete(event.pointerId);
			if (canvas?.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			const endedPinch = pinching;
			if (event.isPrimary || touchPointerIds.size === 0) pinching = false;
			if (endedPinch) {
				scrubPointerId = null;
				scrubbedDuringGesture = false;
				return;
			}
			if (event.pointerId === scrubPointerId) {
				// A tap still seeks. A second finger never reaches this path.
				if (!scrubbedDuringGesture) onscrub(timeFromPointer(event));
				onscrubend();
				scrubPointerId = null;
				scrubbedDuringGesture = false;
			}
			return;
		}

		if (canvas?.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}
		// Always close out the scrub, even if capture was already lost (e.g. the
		// browser cancelled the pointer), so the engine never stays in scrub mode.
		if (!isDragging) onscrubend();
		isDragging = false;
	}

	function zoomIn() {
		const newZoom = Math.min(zoomLevel * 2, 32);
		// Center zoom on current play position
		zoomLevel = newZoom;
		panOffset = clamp(currentTime - visibleDuration / 2, 0, duration - visibleDuration);
	}

	function zoomOut() {
		const newZoom = Math.max(zoomLevel / 2, 1);
		// Center zoom on current play position  
		zoomLevel = newZoom;
		panOffset = clamp(currentTime - visibleDuration / 2, 0, duration - visibleDuration);
	}

	function resetZoom() {
		zoomLevel = 1;
		panOffset = 0;
		followPlayhead = false; // Disable follow when resetting
	}

	function toggleFollow() {
		followPlayhead = !followPlayhead;
		// If enabling follow, immediately center on playhead
		if (followPlayhead && zoomLevel > 1) {
			panOffset = clamp(currentTime - visibleDuration / 2, 0, duration - visibleDuration);
		}
	}

	// Pan bar interaction
	function onPanBarDown(event: PointerEvent) {
		if (!duration) return;
		
		// Record initial mouse position and current pan offset
		panBarStartX = event.clientX;
		panBarStartOffset = panOffset;
		
		panBarDragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPanBarMove(event: PointerEvent) {
		if (!panBarDragging || !duration) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		
		// Calculate how far the mouse has moved in pixels
		const deltaX = event.clientX - panBarStartX;
		
		// Convert pixel movement to time offset based on pan bar width
		const deltaTime = (deltaX / rect.width) * (duration - visibleDuration);
		
		// Apply the delta to the original pan offset
		panOffset = clamp(panBarStartOffset + deltaTime, 0, duration - visibleDuration);
	}

	function onPanBarUp(event: PointerEvent) {
		if (panBarDragging) {
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
			panBarDragging = false;
		}
	}

	function onKey(event: KeyboardEvent) {
		if (duration <= 0) return;
		const step = event.shiftKey ? 1 : 0.1;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const delta = event.key === 'ArrowLeft' ? -step : step;
		onscrub(clamp(currentTime + delta, 0, duration));
		onscrubend();
	}

	function onWheel(event: WheelEvent) {
		// Allow regular mouse wheel zoom when over waveform (no Ctrl required)
		event.preventDefault();
		
		const rect = canvas?.getBoundingClientRect();
		if (!rect) return;
		
		// Get mouse position for zoom centering
		const mouseX = event.clientX - rect.left;
		const mouseRatio = mouseX / rect.width;
		const mouseTime = visibleStart + mouseRatio * visibleDuration;
		
		// Zoom based on wheel direction
		const zoomDirection = event.deltaY < 0 ? 1 : -1;
		const currentZoom = zoomLevel;
		const newZoom = clamp(currentZoom * (1 + zoomDirection * 0.2), 1, 32);
		
		zoomLevel = newZoom;
		
		// Adjust pan to keep mouse position centered
		panOffset = clamp(mouseTime - mouseRatio * (duration / newZoom), 0, duration - (duration / newZoom));
	}

	// Touch gesture support
	function getTouchDistance(touches: TouchList): number {
		if (touches.length < 2) return 0;
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function getTouchCenter(touches: TouchList): number {
		if (touches.length === 0) return 0;
		let sum = 0;
		for (let i = 0; i < touches.length; i++) {
			sum += touches[i].clientX;
		}
		return sum / touches.length;
	}

	function onTouchStart(event: TouchEvent) {
		activeTouches = event.touches.length;

		if (event.touches.length === 1) {
			singleTouchAt = performance.now();
			return;
		}

		if (event.touches.length === 2) {
			// Two finger gesture - pinch zoom and pan. Never seeks.
			event.preventDefault();
			multiTouchAt = performance.now();
			beginPinch();
			touchStartDistance = getTouchDistance(event.touches);
			touchStartZoom = zoomLevel;
			const rect = canvas?.getBoundingClientRect();
			if (rect && rect.width > 0 && visibleDuration > 0) {
				const ratio = (getTouchCenter(event.touches) - rect.left) / rect.width;
				pinchFocalTime = visibleStart + ratio * visibleDuration;
			}
		}
	}

	function onTouchMove(event: TouchEvent) {
		if (event.touches.length !== 2 || touchStartDistance <= 0 || duration <= 0) return;
		// Two finger pinch zoom and pan, anchored on the midpoint between the fingers.
		event.preventDefault();

		const rect = canvas?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return;

		const scale = getTouchDistance(event.touches) / touchStartDistance;
		const newZoom = clamp(touchStartZoom * scale, 1, 32);
		const newVisible = duration / newZoom;
		const ratio = (getTouchCenter(event.touches) - rect.left) / rect.width;

		zoomLevel = newZoom;
		// Keep the time that was under the pinch center under the center as it moves.
		panOffset = clamp(pinchFocalTime - ratio * newVisible, 0, Math.max(0, duration - newVisible));
	}

	function onTouchEnd(event: TouchEvent) {
		activeTouches = event.touches.length;
		if (event.touches.length > 0) return;
		touchStartDistance = 0;
		pinching = false;
		multiTouchAt = 0;
		singleTouchAt = 0;
		touchPointerIds.clear();
	}

	// Cue interaction state
	let cueDragMoved = $state(false);
	let dragTimer = $state<number | null>(null);
	let isDragReady = $state(false);
	let dragHoldThreshold = 250; // ms to hold before drag activates

	// Handle cue click vs drag
	function handleCueClick(event: MouseEvent, cue: Cue) {
		// Only handle click if it wasn't a drag
		if (!cueDragMoved) {
			// A tap is a one-shot seek. Without onscrubend the engine stays in
			// "scrubbing" mode and suspends loop / stop-at-cue indefinitely.
			onscrub(cue.time);
			onscrubend();
		}
	}

	// Cue dragging functions
	function startCueDrag(event: PointerEvent, cue: Cue) {
		// Only start cue drag on left-click, let right-click pass through for panning
		if (event.button !== 0) return;
		
		event.stopPropagation();
		
		// Clear any existing timer
		if (dragTimer) {
			clearTimeout(dragTimer);
			dragTimer = null;
		}
		
		// Set up drag preparation (but don't start dragging yet)
		draggedCue = cue.id;
		dragStartX = event.clientX;
		dragStartTime = cue.time;
		cueDragMoved = false;
		isDragReady = false;
		
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		
		// Start timer to enable dragging after delay
		dragTimer = setTimeout(() => {
			isDragReady = true;
			dragTimer = null;
		}, dragHoldThreshold);
	}

	function moveCueDrag(event: PointerEvent) {
		if (!draggedCue || !canvas || !onmove) return;
		
		// Only allow dragging if hold threshold has been met
		if (!isDragReady) return;
		
		// Mark that we've moved (not just a click)
		const dx = Math.abs(event.clientX - dragStartX);
		if (dx > 3) {
			cueDragMoved = true;
		}
		
		const rect = canvas.getBoundingClientRect();
		const timeDelta = ((event.clientX - dragStartX) / rect.width) * visibleDuration;
		const newTime = clamp(dragStartTime + timeDelta, 0, duration);
		
		// Update the cue position via parent component
		onmove(draggedCue, newTime);
	}

	function endCueDrag(event: PointerEvent) {
		if (draggedCue) {
			// Clear timer if still running
			if (dragTimer) {
				clearTimeout(dragTimer);
				dragTimer = null;
			}
			
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
			
			// Prevent click event if we dragged
			if (cueDragMoved) {
				event.preventDefault();
			}
			
			draggedCue = null;
			isDragReady = false;
		}
	}

</script>

<div class="waveform-container" role="group" aria-label="Waveform">
	<!-- Zoom Controls -->
	<div class="zoom-controls">
		<!-- Left: Follow Button -->
		<div class="controls-left">
			<button 
				type="button" 
				class="control-btn follow-btn" 
				class:active={followPlayhead}
				onclick={toggleFollow} 
				disabled={zoomLevel <= 1}
				title="Follow playhead when zoomed"
			>
				Follow
			</button>
		</div>
		
		<!-- Center: Zoom Controls -->
		<div class="controls-center">
			<button type="button" class="zoom-btn" onclick={zoomOut} disabled={zoomLevel <= 1} title="Zoom Out">
				<ZoomOut size={16} />
			</button>
			<span class="zoom-level">{zoomLevel.toFixed(1)}×</span>
			<button type="button" class="zoom-btn" onclick={zoomIn} disabled={zoomLevel >= 32} title="Zoom In">
				<ZoomIn size={16} />
			</button>
		</div>

		<!-- Right: Reset Button -->
		<div class="controls-right">
			<button 
				type="button" 
				class="control-btn reset-btn" 
				onclick={resetZoom} 
				disabled={zoomLevel === 1} 
				title="Reset zoom and follow"
			>
				Reset
			</button>
		</div>
	</div>

	<!-- Cue Names Area -->
	<div class="cue-names">
		{#each cues as cue (cue.id)}
			{#if cue.time >= visibleStart && cue.time <= visibleEnd}
				<button
					type="button"
					class="cue-btn"
					class:dragging={draggedCue === cue.id && cueDragMoved}
					class:preparing-drag={draggedCue === cue.id && !isDragReady && dragTimer !== null}
					style:--cue-x="{((cue.time - visibleStart) / visibleDuration) * 100}cqw"
					style:--cue-color={cue.color}
					title="{cue.name} - {cue.time.toFixed(1)}s"
					onclick={(event) => handleCueClick(event, cue)}
					onpointerdown={(event) => startCueDrag(event, cue)}
					onpointermove={moveCueDrag}
					onpointerup={endCueDrag}
					onpointercancel={endCueDrag}
					oncontextmenu={(event) => event.preventDefault()}
				>
					{cue.name}
				</button>
			{/if}
		{/each}
	</div>

	<!-- Waveform -->
	<div class="wave-frame">
		{#if playheadRatio != null && playheadRatio >= 0 && playheadRatio <= 1}
			<div class="playhead-marker" style:left="{playheadRatio * 100}%"></div>
		{/if}
		<div class="wave">
		<canvas
			bind:this={canvas}
			aria-label="Waveform. Click to scrub, scroll to zoom, right-click drag to pan."
			role="slider"
			aria-valuemin={0}
			aria-valuemax={duration}
			aria-valuenow={currentTime}
			aria-valuetext={currentTime.toFixed(1)}
			tabindex="0"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onkeydown={onKey}
			onwheel={onWheel}
			oncontextmenu={(event) => event.preventDefault()}
			ontouchstart={onTouchStart}
			ontouchmove={onTouchMove}
			ontouchend={onTouchEnd}
			ontouchcancel={onTouchEnd}
		></canvas>

		<!-- Cue Lines (visual only, no interaction) -->
		<div class="cue-lines">
			{#each cues as cue (cue.id)}
				{#if cue.time >= visibleStart && cue.time <= visibleEnd}
					<div
						class="cue-line"
						style:left="{((cue.time - visibleStart) / visibleDuration) * 100}%"
						style:--cue-color={cue.color}
					></div>
				{/if}
			{/each}
		</div>
	</div>
	</div>

	<!-- Pan Indicator -->
	<div 
		class="pan-indicator"
		class:visible={zoomLevel > 1}
		onpointerdown={zoomLevel > 1 ? onPanBarDown : undefined}
		onpointermove={zoomLevel > 1 ? onPanBarMove : undefined}
		onpointerup={zoomLevel > 1 ? onPanBarUp : undefined}
		onpointercancel={zoomLevel > 1 ? onPanBarUp : undefined}
		role="slider"
		aria-label="Pan position"
		tabindex={zoomLevel > 1 ? 0 : -1}
	>
		{#if zoomLevel > 1}
			<div 
				class="pan-thumb" 
				class:dragging={panBarDragging || isDragging || followPlayhead}
				style:left="{(visibleStart / duration) * 100}%"
				style:width="{(visibleDuration / duration) * 100}%"
			></div>
		{/if}
	</div>
</div>

<style>
	.waveform-container {
		position: relative;
		margin: 20px 0 0 0;
	}

	.zoom-controls {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 16px;
		margin-bottom: 12px;
	}

	.controls-left {
		display: flex;
		justify-content: flex-start;
	}

	.controls-center {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.controls-right {
		display: flex;
		justify-content: flex-end;
	}

	.zoom-btn {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.1);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
		transition: all 0.2s ease;
		touch-action: manipulation;
	}

	.zoom-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
		transform: translateY(-1px);
	}

	.zoom-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.zoom-level {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted);
		width: 40px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.control-btn {
		height: 44px;
		padding: 0 16px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text);
		font-weight: 600;
		font-size: 0.9rem;
		transition: all 0.2s ease;
		touch-action: manipulation;
	}

	.control-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
		transform: translateY(-1px);
	}

	.control-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.control-btn.active {
		background: var(--accent-rgba-15);
		border-color: var(--accent-rgba-40);
		color: var(--accent);
	}

	.follow-btn {
		min-width: 70px;
	}

	.reset-btn {
		min-width: 65px;
	}

	.wave-frame {
		position: relative;
	}

	.playhead-marker {
		position: absolute;
		top: 0;
		z-index: 2;
		width: 12px;
		height: 8px;
		transform: translate(-50%, -100%);
		background: #fff;
		clip-path: polygon(0 0, 100% 0, 50% 100%);
		pointer-events: none;
	}

	.wave {
		position: relative;
		height: 200px;
		border-radius: 16px;
		background: #0f0f0c;
		touch-action: none;
		overflow: hidden;
	}

	canvas {
		width: 100%;
		height: 100%;
		border-radius: 16px;
		display: block;
		touch-action: none;
		cursor: crosshair;
	}

	.cue-names {
		position: relative;
		height: 40px;
		margin-bottom: 8px;
		overflow: visible;
		container-type: inline-size;
	}

	.cue-btn {
		position: absolute;
		left: 0;
		/* Center on the cue. The stage has 24px of margin, so the label may hang 12px past the waveform. */
		translate: clamp(-12px, calc(var(--cue-x) - 50%), calc(100cqw - 100% + 12px)) 0;
		height: 32px;
		padding: 0 12px;
		border-radius: 16px;
		background: var(--cue-color);
		color: var(--accent-ink);
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
		transition: transform 0.2s ease, box-shadow 0.2s ease;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		border: 1px solid rgba(0, 0, 0, 0.1);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
		touch-action: none;
		min-width: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		top: 4px;
		cursor: grab;
	}

	.cue-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
		z-index: 1;
	}

	.cue-btn.preparing-drag {
		animation: drag-prepare 0.25s ease-out forwards;
		z-index: 1;
	}

	.cue-btn.dragging {
		transition: none;
		z-index: 2;
		cursor: grabbing;
		transform: translateY(-1px) scale(1.05);
	}

	@keyframes drag-prepare {
		0% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.02);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		}
		100% {
			transform: scale(1.05);
			box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
		}
	}

	.pan-indicator {
		position: relative;
		height: 12px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		margin-top: 12px;
		overflow: hidden;
		cursor: pointer;
		touch-action: manipulation;
		padding: 2px 0;
		opacity: 0;
		pointer-events: none;
	}

	.pan-indicator.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.pan-indicator:hover {
		background: rgba(255, 255, 255, 0.15);
	}

	.pan-thumb {
		position: absolute;
		top: 2px;
		height: 8px;
		background: var(--accent);
		border-radius: 4px;
		transition: background-color 0.1s ease;
		min-width: 20px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
	}

	.pan-thumb.dragging {
		transition: none;
	}

	.cue-lines {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
	}

	.cue-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		transform: translateX(-50%);
		background: var(--cue-color);
		opacity: 0.6;
		pointer-events: none;
	}

	.pan-thumb:hover {
		background: var(--accent-light);
	}

	/* Responsive waveform height */
	@media (max-width: 768px) {
		.wave {
			height: 150px;
		}
	}

	@media (max-width: 480px) {
		.wave {
			height: 120px;
		}
	}
</style>
