<script lang="ts">
	import { onDestroy } from 'svelte';
	import { laneHeight, layoutCueLabels } from '$lib/cues/layout';
	import { clamp, roundTime } from '$lib/format';
	import type { Cue } from '$lib/storage/types';

	let {
		cues,
		duration,
		placement,
		editingId = null,
		onplay,
		onmove,
		onrename,
		onedit
	}: {
		cues: Cue[];
		duration: number;
		placement: 'names' | 'marks';
		editingId?: string | null;
		onplay: (cue: Cue) => void;
		onmove: (id: string, time: number) => void;
		onrename: (id: string, name: string) => void;
		onedit: (id: string) => void;
	} = $props();

	let root = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let drag: {
		id: string;
		originX: number;
		originTime: number;
		moved: boolean;
		held: boolean;
	} | null = null;
	let holdTimer = 0;

	const placed = $derived(layoutCueLabels(cues, duration, width));
	const byId = $derived(new Map(placed.map((item) => [item.id, item])));
	const height = $derived(placement === 'names' ? laneHeight(placed) : 44);

	$effect(() => {
		const el = root;
		if (!el) return;
		const measure = () => {
			width = el.clientWidth;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (placement !== 'names' || !editingId) return;
		const input = root?.querySelector('input');
		if (input instanceof HTMLInputElement) {
			input.focus();
			input.select();
		}
	});

	function startDrag(event: PointerEvent, cue: Cue) {
		if (placement !== 'names' || editingId === cue.id) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = {
			id: cue.id,
			originX: event.clientX,
			originTime: cue.time,
			moved: false,
			held: false
		};
		holdTimer = window.setTimeout(() => {
			if (!drag || drag.id !== cue.id) return;
			drag.held = true;
			onedit(cue.id);
		}, 450);
	}

	function moveDrag(event: PointerEvent) {
		if (!drag || drag.id !== (event.currentTarget as HTMLElement).dataset.id) return;
		const dx = event.clientX - drag.originX;
		if (Math.abs(dx) > 6) {
			drag.moved = true;
			window.clearTimeout(holdTimer);
		}
		if (!drag.moved || duration <= 0 || width <= 0) return;
		const time = clamp(drag.originTime + (dx / width) * duration, 0, duration);
		onmove(drag.id, roundTime(time));
	}

	function endDrag(cue: Cue, play: boolean) {
		window.clearTimeout(holdTimer);
		const current = drag;
		drag = null;
		if (!play || !current || current.id !== cue.id || current.held || current.moved) return;
		onplay(cue);
	}

	onDestroy(() => window.clearTimeout(holdTimer));
</script>

<div
	class="lane"
	class:marks={placement === 'marks'}
	bind:this={root}
	style:height="{placement === 'names' ? height : 44}px"
	aria-label={placement === 'names' ? 'Cue names' : 'Cue marks'}
>
	{#each cues as cue (cue.id)}
		{@const item = byId.get(cue.id)}
		{#if item && placement === 'names'}
			{#if editingId === cue.id}
				<input
					class="cue-label input"
					style:left="{item.left}px"
					style:width="{Math.max(item.width, 120)}px"
					style:top="{item.row * 48}px"
					style:--mark={cue.color}
					value={cue.name}
					aria-label="Cue name"
					onpointerdown={(event) => event.stopPropagation()}
					onblur={(event) => onrename(cue.id, event.currentTarget.value)}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.currentTarget.blur();
					}}
				/>
			{:else}
				<button
					type="button"
					class="cue-label"
					data-id={cue.id}
					style:left="{item.left}px"
					style:width="{item.width}px"
					style:top="{item.row * 48}px"
					style:--mark={cue.color}
					onpointerdown={(event) => startDrag(event, cue)}
					onpointermove={moveDrag}
					onpointerup={() => endDrag(cue, true)}
					onpointercancel={() => endDrag(cue, false)}
					oncontextmenu={(event) => event.preventDefault()}
				>
					{cue.name}
				</button>
			{/if}
		{:else if placement === 'marks' && duration > 0}
			<button
				type="button"
				class="mark"
				style:left="{(cue.time / duration) * 100}%"
				style:--mark={cue.color}
				aria-label="Play {cue.name}"
				onclick={() => onplay(cue)}
			></button>
		{/if}
	{/each}
</div>

<style>
	.lane {
		position: relative;
		overflow-x: hidden;
		overflow-y: auto;
		max-height: 36vh;
	}

	.lane.marks {
		overflow: visible;
		height: 44px;
		max-height: none;
	}

	.cue-label {
		position: absolute;
		height: 44px;
		padding: 0 12px;
		border-radius: 999px;
		background: var(--bg-elev-2);
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		touch-action: none;
		box-shadow: inset 0 -3px 0 var(--mark);
	}

	.input {
		text-align: left;
	}

	.mark {
		position: absolute;
		top: 0;
		width: 44px;
		height: 44px;
		transform: translateX(-50%);
		background: transparent;
	}

	.mark::after {
		content: '';
		position: absolute;
		left: 16px;
		top: 12px;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background: var(--mark);
	}
</style>
