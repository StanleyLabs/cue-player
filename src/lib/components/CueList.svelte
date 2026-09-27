<script lang="ts">
	import { formatTime } from '$lib/format';
	import type { Cue } from '$lib/storage/types';
	import { CUE_COLORS } from '$lib/cues/names';

	let {
		cues,
		editMode = false,
		onplay,
		onrename,
		ondelete,
		oncolorchange
	}: {
		cues: Cue[];
		editMode?: boolean;
		onplay: (cue: Cue) => void;
		onrename: (id: string, name: string) => void;
		ondelete: (id: string) => void;
		oncolorchange: (id: string, color: string) => void;
	} = $props();

	let editingCueId = $state<string | null>(null);
	let colorPickerOpen = $state<string | null>(null);

	const ordered = $derived([...cues].sort((a, b) => a.time - b.time));

	// Close color picker when clicking outside
	$effect(() => {
		if (!colorPickerOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			if (!target.closest('.color-picker')) {
				colorPickerOpen = null;
			}
		};

		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});
</script>

{#if ordered.length === 0}
	<p class="status">No cues yet. Mark one from the playhead.</p>
{:else}
	<ul>
		{#each ordered as cue (cue.id)}
			<li 
				class="cue-item"
				class:editing={editMode && editingCueId === cue.id}
				style:--cue-color={cue.color}
			>
				{#if editMode}
					<!-- Edit Mode Layout -->
					<div class="cue-content">
						{#if editingCueId === cue.id}
							<input
								class="cue-name-input"
								value={cue.name}
								aria-label="Name for cue at {formatTime(cue.time)}"
								onblur={(event) => {
									onrename(cue.id, event.currentTarget.value);
									editingCueId = null;
								}}
								onkeydown={(event) => {
									if (event.key === 'Enter') {
										event.currentTarget.blur();
									}
								}}
							/>
						{:else}
							<button 
								type="button" 
								class="cue-name-btn"
								onclick={() => (editingCueId = cue.id)}
							>
								{cue.name}
							</button>
						{/if}
						<span class="cue-time">{formatTime(cue.time)}</span>
						
						<!-- Color Picker -->
						<div class="color-picker">
							<button
								type="button"
								class="color-current"
								style:background-color={cue.color}
								title="Change color"
								onclick={() => (colorPickerOpen = colorPickerOpen === cue.id ? null : cue.id)}
							></button>
							
							{#if colorPickerOpen === cue.id}
								<div class="color-popup">
									{#each CUE_COLORS as color}
										<button
											type="button"
											class="color-option"
											style:background-color={color}
											title="Change to this color"
											onclick={() => {
												oncolorchange(cue.id, color);
												colorPickerOpen = null;
											}}
										></button>
									{/each}
								</div>
							{/if}
						</div>
						
						<button type="button" class="delete-btn" onclick={() => ondelete(cue.id)}>
							Delete
						</button>
					</div>
				{:else}
					<!-- View Mode Layout -->
					<button 
						type="button" 
						class="cue-row-btn"
						onclick={() => onplay(cue)}
					>
						<span class="cue-name">{cue.name}</span>
						<span class="cue-time">{formatTime(cue.time)}</span>
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cue-item {
		border-radius: 12px;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--cue-color) 18%, rgba(255, 255, 255, 0.03)) 0%,
			color-mix(in srgb, var(--cue-color) 12%, rgba(255, 255, 255, 0.02)) 100%
		);
		border: 1px solid color-mix(in srgb, var(--cue-color) 20%, rgba(255, 255, 255, 0.1));
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		overflow: hidden;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		cursor: pointer;
	}

	.cue-item:hover {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--cue-color) 25%, rgba(255, 255, 255, 0.06)) 0%,
			color-mix(in srgb, var(--cue-color) 18%, rgba(255, 255, 255, 0.04)) 100%
		);
		border-color: color-mix(in srgb, var(--cue-color) 35%, rgba(255, 255, 255, 0.2));
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.cue-item:active {
		transform: translateY(0);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	/* View Mode - Full row button */
	.cue-row-btn {
		width: 100%;
		height: 56px;
		padding: 0 16px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		text-align: left;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.2s ease;
		box-sizing: border-box;
	}

	.cue-row-btn:hover {
		background: color-mix(in srgb, var(--cue-color) 8%, transparent);
	}

	.cue-row-btn:active {
		background: color-mix(in srgb, var(--cue-color) 12%, transparent);
	}

	.cue-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		padding-left: 9px;
	}

	.cue-time {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--muted);
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
		display: flex;
		align-items: center;
		height: 32px;
	}

	/* Edit Mode */
	.cue-content {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 16px;
		gap: 12px;
		box-sizing: border-box;
	}

	.cue-name-btn {
		flex: 1;
		text-align: left;
		padding: 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		transition: all 0.2s ease;
		height: 32px;
		display: flex;
		align-items: center;
		box-sizing: border-box;
	}

	.cue-name-btn:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(255, 255, 255, 0.1);
	}

	.cue-name-input {
		flex: 1;
		padding: 8px;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		height: 32px;
		box-sizing: border-box;
	}

	.delete-btn {
		padding: 0 12px;
		background: rgba(255, 141, 122, 0.1);
		border: 1px solid rgba(255, 141, 122, 0.2);
		border-radius: 6px;
		color: var(--danger);
		font-size: 0.8rem;
		font-weight: 600;
		transition: all 0.2s ease;
		flex-shrink: 0;
		margin-left: 8px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
	}

	.delete-btn:hover {
		background: rgba(255, 141, 122, 0.15);
		border-color: var(--danger);
	}

	.color-picker {
		position: relative;
		display: flex;
		align-items: center;
	}

	.color-current {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.3);
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.color-current:hover {
		transform: scale(1.1);
		border-color: rgba(255, 255, 255, 0.6);
	}

	.color-popup {
		position: absolute;
		top: 50%;
		right: 28px;
		transform: translateY(-50%);
		background: var(--bg-elev);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		padding: 8px;
		display: flex;
		gap: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	.color-option {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.color-option:hover {
		transform: scale(1.1);
		border-color: rgba(255, 255, 255, 0.4);
	}

	.status {
		text-align: center;
		padding: 40px 20px;
		color: var(--muted);
		font-size: 1rem;
		line-height: 1.5;
	}
</style>
