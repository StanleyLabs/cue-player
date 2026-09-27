<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { enablePlaybackSession } from '$lib/audio/engine';
	import { AUDIO_ACCEPT, isAudioFile, NOT_AUDIO_MESSAGE, pickAudioFile } from '$lib/files/pick';
	import { formatTime } from '$lib/format';
	import { recallFile } from '$lib/storage/session';
	import { deletePiece, downloadBackup, importBackup, listPieces, mutatePiece, openAudioFile } from '$lib/storage/library';
	import type { Piece } from '$lib/storage/types';
	import { Settings } from '@lucide/svelte';

	let pieces = $state<Piece[]>(listPieces());
	let message = $state('');
	let error = $state('');
	let busy = $state(false);
	let renamingId = $state<string | null>(null);
	let pendingDelete = $state<string | null>(null);
	let audioInput = $state<HTMLInputElement | null>(null);
	let backupInput = $state<HTMLInputElement | null>(null);
	let showSettings = $state(false);
	let currentAccent = $state('#e2ff57');

	const accentColors = [
		{ name: 'Lime', value: '#e2ff57', light: '#f0ff9a' },
		{ name: 'Blue', value: '#57b3ff', light: '#8fd1ff' },
		{ name: 'Purple', value: '#b557ff', light: '#d18fff' },
		{ name: 'Pink', value: '#ff57b3', light: '#ff8fd1' },
		{ name: 'Orange', value: '#ff8f57', light: '#ffb08f' },
		{ name: 'Teal', value: '#57ffb3', light: '#8fffd1' }
	];

	afterNavigate(() => {
		pieces = listPieces();
	});

	// Load saved accent color
	$effect(() => {
		const saved = localStorage.getItem('accent-color');
		if (saved) {
			currentAccent = saved;
			setAccentColor(saved);
		}
	});

	function setAccentColor(color: string) {
		const colorInfo = accentColors.find(c => c.value === color);
		if (colorInfo) {
			currentAccent = color;
			// Set main colors
			document.documentElement.style.setProperty('--accent', color);
			document.documentElement.style.setProperty('--accent-light', colorInfo.light);
			
			// Set rgba variations for shadows and effects
			const hex = color.replace('#', '');
			const r = parseInt(hex.substr(0, 2), 16);
			const g = parseInt(hex.substr(2, 2), 16);
			const b = parseInt(hex.substr(4, 2), 16);
			
			document.documentElement.style.setProperty('--accent-rgba-01', `rgba(${r}, ${g}, ${b}, 0.01)`);
			document.documentElement.style.setProperty('--accent-rgba-02', `rgba(${r}, ${g}, ${b}, 0.02)`);
			document.documentElement.style.setProperty('--accent-rgba-08', `rgba(${r}, ${g}, ${b}, 0.08)`);
			document.documentElement.style.setProperty('--accent-rgba-15', `rgba(${r}, ${g}, ${b}, 0.15)`);
			document.documentElement.style.setProperty('--accent-rgba-16', `rgba(${r}, ${g}, ${b}, 0.16)`);
			document.documentElement.style.setProperty('--accent-rgba-20', `rgba(${r}, ${g}, ${b}, 0.2)`);
			document.documentElement.style.setProperty('--accent-rgba-25', `rgba(${r}, ${g}, ${b}, 0.25)`);
			document.documentElement.style.setProperty('--accent-rgba-30', `rgba(${r}, ${g}, ${b}, 0.3)`);
			document.documentElement.style.setProperty('--accent-rgba-40', `rgba(${r}, ${g}, ${b}, 0.4)`);
			
			localStorage.setItem('accent-color', color);
		}
		showSettings = false;
	}

	// Close rename input when clicking outside
	$effect(() => {
		if (!renamingId) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			// Don't close if clicking on the input or rename button
			if (!target.closest('.text-input') && !target.closest('button')) {
				renamingId = null;
			}
		};

		// Add slight delay to prevent immediate closing when rename button is clicked
		const timeoutId = setTimeout(() => {
			document.addEventListener('click', handleClickOutside);
		}, 100);

		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener('click', handleClickOutside);
		};
	});

	// Close settings when clicking outside
	$effect(() => {
		if (!showSettings) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			if (!target.closest('.settings-btn') && !target.closest('.settings-popup')) {
				showSettings = false;
			}
		};

		const timeoutId = setTimeout(() => {
			document.addEventListener('click', handleClickOutside);
		}, 100);

		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener('click', handleClickOutside);
		};
	});

	async function chooseAudio() {
		enablePlaybackSession();
		const result = await pickAudioFile();
		if (result.kind === 'file') await ingest(result.file);
		else if (result.kind === 'fallback') audioInput?.click();
	}

	async function onAudioInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) await ingest(file);
	}

	async function ingest(file: File) {
		if (!isAudioFile(file)) {
			error = NOT_AUDIO_MESSAGE;
			message = '';
			return;
		}
		busy = true;
		error = '';
		message = 'Reading audio…';
		try {
			const piece = await openAudioFile(file);
			await goto(`/player/${piece.id}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not read that audio file.';
			message = '';
		} finally {
			busy = false;
		}
	}

	function onBackupInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		void file.text().then((text) => {
			try {
				const result = importBackup(text);
				pieces = listPieces();
				message = `Restored ${result.added + result.updated} pieces.`;
				error = '';
			} catch (err) {
				error = err instanceof Error ? err.message : 'Could not import that backup.';
			}
		});
	}

	function saveTitle(piece: Piece, value: string) {
		const title = value.trim() || 'Untitled';
		mutatePiece(piece.id, (current) => ({ ...current, title }));
		renamingId = null;
		pieces = listPieces();
	}

	function remove(id: string) {
		deletePiece(id);
		pendingDelete = null;
		pieces = listPieces();
	}
</script>

<svelte:head>
	<title>Cue Player</title>
</svelte:head>

<div class="app-screen">
	<header class="topbar library-head">
		<div>
			<h1>Cue Player</h1>
		</div>
		<button 
			type="button" 
			class="settings-btn"
			onclick={() => (showSettings = !showSettings)}
			title="Accent Color"
		>
			<Settings size={20} />
		</button>
		
		{#if showSettings}
			<div class="settings-popup">
				<h3>Accent Color</h3>
				<div class="accent-colors">
					{#each accentColors as color}
						<button
							type="button"
							class="accent-swatch"
							class:active={currentAccent === color.value}
							style:background-color={color.value}
							title={color.name}
							onclick={() => setAccentColor(color.value)}
						></button>
					{/each}
				</div>
			</div>
		{/if}
	</header>
	<main class="scroll">
		<div class="btn-row">
			<button type="button" class="btn btn-primary" onclick={chooseAudio} disabled={busy}>
				{busy ? 'Reading…' : 'Import audio'}
			</button>
			<button type="button" class="btn" onclick={downloadBackup}>Export backup</button>
			<button type="button" class="btn" onclick={() => backupInput?.click()}>Import backup</button>
		</div>
		{#if message}
			<p class="status" class:reading={busy} aria-live="polite">{message}</p>
		{/if}
		{#if error}
			<p class="status error" aria-live="assertive">{error}</p>
		{/if}

		{#if pieces.length === 0}
			<section class="empty">
				<p>Import a song, then mark the spots you need to hear again.</p>
			</section>
		{:else}
			<ul class="pieces">
				{#each pieces as piece (piece.id)}
					<li 
						class:clickable={renamingId !== piece.id && pendingDelete !== piece.id}
						onclick={(event) => {
							// Only navigate if not in rename/delete mode and not clicking on buttons
							if (renamingId === piece.id || pendingDelete === piece.id) return;
							const target = event.target as HTMLElement;
							if (target.closest('button') || target.closest('.piece-actions')) return;
							goto(`/player/${piece.id}`);
						}}
					>
						{#if renamingId === piece.id}
							<div class="piece-content">
								<input
									class="title-input-rename"
									value={piece.title}
									aria-label="Piece title"
									onblur={(event) => saveTitle(piece, event.currentTarget.value)}
									onkeydown={(event) => {
										if (event.key === 'Enter') event.currentTarget.blur();
									}}
								/>
								<div class="piece-bottom">
									<span class="piece-info">
										{piece.cues.length} {piece.cues.length === 1 ? 'cue' : 'cues'} · {formatTime(piece.duration)}
										· {recallFile(piece.fileHash) ? 'Ready' : 'Attach to play'}
									</span>
									<div class="piece-actions" class:pass-through={pendingDelete !== piece.id}>
										{#if pendingDelete === piece.id}
											<button type="button" class="btn btn-danger" onclick={() => remove(piece.id)}>Delete</button>
											<button type="button" class="btn" onclick={() => (pendingDelete = null)}>Keep</button>
										{:else}
											<button type="button" class="btn" onclick={() => (renamingId = piece.id)}>Rename</button>
											<button type="button" class="btn" onclick={() => (pendingDelete = piece.id)}>Delete</button>
										{/if}
									</div>
								</div>
							</div>
						{:else}
							<div class="piece-content">
								<strong class="piece-title">{piece.title}</strong>
								<div class="piece-bottom">
									<span class="piece-info">
										{piece.cues.length} {piece.cues.length === 1 ? 'cue' : 'cues'} · {formatTime(piece.duration)}
										· {recallFile(piece.fileHash) ? 'Ready' : 'Attach to play'}
									</span>
									<div class="piece-actions" class:pass-through={pendingDelete !== piece.id}>
										{#if pendingDelete === piece.id}
											<button type="button" class="btn btn-danger" onclick={() => remove(piece.id)}>Delete</button>
											<button type="button" class="btn" onclick={() => (pendingDelete = null)}>Keep</button>
										{:else}
											<button type="button" class="btn" onclick={() => (renamingId = piece.id)}>Rename</button>
											<button type="button" class="btn" onclick={() => (pendingDelete = piece.id)}>Delete</button>
										{/if}
									</div>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</main>
	<input bind:this={audioInput} type="file" accept={AUDIO_ACCEPT} hidden onchange={onAudioInput} />
	<input bind:this={backupInput} type="file" accept="application/json,.json" hidden onchange={onBackupInput} />
</div>

<style>
	.library-head {
		background: linear-gradient(135deg, var(--bg) 0%, var(--accent-rgba-02) 100%);
		border-bottom: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		align-items: center;
		position: relative;
	}

	.library-head h1 {
		font-size: 2.25rem;
		font-weight: 700;
		background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		letter-spacing: -0.04em;
	}

	.library-head .eyebrow {
		font-weight: 600;
		letter-spacing: 0.12em;
	}

	main.scroll {
		padding-top: 24px;
	}

	.settings-btn {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--text);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.settings-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		transform: translateY(-1px);
	}

	.settings-popup {
		position: absolute;
		top: 60px;
		right: 0;
		background: var(--bg-elev);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 16px;
		padding: 20px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
		z-index: 100;
		min-width: 200px;
	}

	.settings-popup h3 {
		margin: 0 0 16px;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
	}

	.accent-colors {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.accent-swatch {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 3px solid transparent;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.accent-swatch:hover {
		transform: scale(1.1);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.accent-swatch.active {
		border-color: rgba(255, 255, 255, 0.8);
		transform: scale(1.1);
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2);
	}

	.empty {
		margin-top: 32px;
		padding: 32px;
		border-radius: 24px;
		background: linear-gradient(135deg, var(--bg-elev) 0%, var(--bg-elev-2) 100%);
		border: 1px solid var(--accent-rgba-08);
		text-align: center;
	}

	.empty p {
		margin: 0;
		font-size: 1.1rem;
		color: var(--muted);
		line-height: 1.5;
	}

	.pieces {
		list-style: none;
		margin: 32px 0 0;
		padding: 0;
		display: grid;
		gap: 16px;
	}

	@media (min-width: 768px) {
		.pieces {
			grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
		}
	}

	li {
		padding: 20px;
		border-radius: 20px;
		background: linear-gradient(135deg, var(--bg-elev) 0%, var(--bg-elev-2) 100%);
		border: 1px solid rgba(255, 255, 255, 0.05);
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
	}

	li.clickable {
		cursor: pointer;
	}

	li.clickable:hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
		border-color: var(--accent-rgba-30);
		background: linear-gradient(135deg, 
			color-mix(in srgb, var(--bg-elev) 90%, var(--accent) 10%) 0%, 
			color-mix(in srgb, var(--bg-elev-2) 90%, var(--accent) 10%) 100%);
	}

	.piece-content {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 56px;
	}

	.piece-title {
		font-size: 1.25rem;
		font-weight: 650;
		line-height: 1.3;
		color: var(--text);
		letter-spacing: -0.02em;
	}

	.title-input-rename {
		font-size: 1.25rem;
		font-weight: 650;
		line-height: 1.3;
		color: var(--text);
		letter-spacing: -0.02em;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: 8px;
		padding: 8px 12px;
		width: 100%;
	}

	.piece-bottom {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}

	.piece-info {
		color: var(--muted);
		font-size: 0.95rem;
		line-height: 1.4;
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
	}

	.piece-info::before {
		content: '♪';
		color: var(--accent);
		font-size: 1.1rem;
	}

	.piece-actions {
		display: flex;
		gap: 10px;
		flex-shrink: 0;
	}

	.piece-actions.pass-through {
		pointer-events: none;
	}

	.piece-actions.pass-through button {
		pointer-events: auto;
	}

	.piece-actions .btn {
		font-size: 0.9rem;
		padding: 8px 16px;
		min-height: 36px;
		font-weight: 500;
	}

	.status {
		margin-top: 20px;
		padding: 16px 20px;
		border-radius: 16px;
		background: var(--bg-elev);
		border-left: 4px solid var(--accent);
		font-size: 0.95rem;
	}

	.status.reading {
		margin-top: 16px;
		padding: 0;
		border: none;
		border-radius: 0;
		background: none;
		color: var(--muted);
		font-weight: 500;
		animation: status-pulse 2s ease-in-out infinite;
	}

	.status.error {
		border-left-color: var(--danger);
		background: rgba(255, 141, 122, 0.05);
	}

	@keyframes status-pulse {
		0%, 100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}

	.btn-row {
		gap: 12px;
	}

	.btn-row .btn {
		font-weight: 600;
		transition: all 0.2s ease;
	}

	.btn-row .btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}

	.btn-primary {
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
		box-shadow: 0 2px 8px var(--accent-rgba-30);
	}
</style>
