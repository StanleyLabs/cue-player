<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { onMount } from 'svelte';
	import CueLane from '$lib/components/CueLane.svelte';
	import CueList from '$lib/components/CueList.svelte';
	import Transport from '$lib/components/Transport.svelte';
	import Waveform from '$lib/components/Waveform.svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { AudioEngine, enablePlaybackSession, type EngineSnapshot } from '$lib/audio/engine';
	import { computePeaks, type Peaks } from '$lib/audio/peaks';
	import { nextCueColor, nextCueName, smartCueColor } from '$lib/cues/names';
	import { phraseBounds } from '$lib/cues/phrase';
	import { AUDIO_ACCEPT, isAudioFile, NOT_AUDIO_MESSAGE, pickAudioFile } from '$lib/files/pick';
	import { clamp, formatTime, roundTime } from '$lib/format';
	import { recallFile, rememberFile } from '$lib/storage/session';
	import { hashFile } from '$lib/storage/hash';
	import { findByHash, getPiece, mutatePiece, openAudioFile } from '$lib/storage/library';
	import type { Cue, EndBehavior, Piece } from '$lib/storage/types';

	const engine = browser ? new AudioEngine() : null;

	let piece = $state<Piece | null>(null);
	let activeId = $state('');
	let attached = $state(false);
	let currentTime = $state(0);
	let playing = $state(false);
	let peaks = $state<Peaks | null>(null);
	let peaksStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let editingCueId = $state<string | null>(null);
	let sheetOpen = $state(false);
	let wide = $state(browser ? window.matchMedia('(min-width: 960px)').matches : false);
	let status = $state('');
	let mismatchName = $state('');
	let pendingFile = $state<File | null>(null);
	let busy = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let titleInput = $state<HTMLInputElement | null>(null);
	let titleOverflowing = $state(false);
	let cueListEditMode = $state(false);
	let cueListExpanded = $state(false);
	let showAttachPopup = $state(false);

	// Touch drag state
	let isDragging = $state(false);
	let dragStartY = $state(0);
	let dragStartExpanded = $state(false);
	let hasMoved = $state(false);
	let touchStartTime = $state(0);

	let loadedHash = '';
	let attachToken = 0;
	let objectUrl: string | null = null;

	const orderedCues = $derived(piece ? [...piece.cues].sort((a, b) => a.time - b.time) : []);
	const previousCue = $derived(
		[...orderedCues].reverse().find((cue) => cue.time < currentTime - 0.05) ?? null
	);
	const upcomingCue = $derived(orderedCues.find((cue) => cue.time > currentTime + 0.05) ?? null);
	const phrase = $derived(
		phraseBounds(
			currentTime,
			orderedCues.map((cue) => cue.time),
			piece?.duration ?? 0
		)
	);

	$effect(() => {
		const id = page.params.id ?? '';
		if (!id || id === activeId) return;
		activeId = id;
		attached = false;
		piece = browser ? getPiece(id) : null;
		peaks = null;
		peaksStatus = 'idle';
		playing = false;
		currentTime = 0;
		editingCueId = null;
		sheetOpen = false;
		mismatchName = '';
		pendingFile = null;
		status = '';
		loadedHash = '';
		attachToken += 1;
		engine?.pause();
		revokeUrl();
	});

	$effect(() => {
		if (!engine || !piece) return;
		engine.setRate(piece.rate);
		engine.setLoop(piece.loopEnabled);
		engine.setEndBehavior(piece.endBehavior);
		engine.setCueTimes(piece.cues.map((cue) => cue.time));
	});

	$effect(() => {
		const hash = piece?.fileHash;
		if (!engine || !hash || hash === loadedHash) return;
		const file = recallFile(hash);
		if (!file) return;
		loadedHash = hash;
		const token = ++attachToken;
		void connect(file, token);
	});

	onMount(() => {
		const unsubscribe = engine?.subscribe(onEngine);
		const media = window.matchMedia('(min-width: 960px)');
		const syncWide = () => {
			wide = media.matches;
			if (wide) sheetOpen = false;
		};
		syncWide();
		media.addEventListener('change', syncWide);

		// Enhanced orientation locking
		const lockOrientation = async () => {
			try {
				// Method 1: Modern Screen Orientation API
				if (screen.orientation && screen.orientation.lock) {
					await screen.orientation.lock('portrait');
					console.log('Orientation locked via Screen Orientation API');
					return;
				}
			} catch (error) {
				console.log('Screen Orientation API failed:', error);
			}

			try {
				// Method 2: Legacy screen.lockOrientation (Android)
				const legacyLock = screen.lockOrientation || 
					screen.mozLockOrientation || 
					screen.msLockOrientation;
				if (legacyLock) {
					legacyLock('portrait');
					console.log('Orientation locked via legacy API');
					return;
				}
			} catch (error) {
				console.log('Legacy orientation API failed:', error);
			}

			// Method 3: CSS and meta tags (already added)
			console.log('Using CSS and meta tag orientation hints');
		};

		// Try to lock orientation immediately and on various events
		lockOrientation();
		
		// Also try after delays in case APIs aren't ready immediately
		setTimeout(lockOrientation, 100);
		setTimeout(lockOrientation, 1000);
		
		// Re-lock when orientation changes
		const handleOrientationChange = () => {
			setTimeout(lockOrientation, 100);
		};
		
		window.addEventListener('orientationchange', handleOrientationChange);
		screen.orientation?.addEventListener('change', handleOrientationChange);

		return () => {
			unsubscribe?.();
			media.removeEventListener('change', syncWide);
			window.removeEventListener('orientationchange', handleOrientationChange);
			screen.orientation?.removeEventListener('change', handleOrientationChange);
			engine?.destroy();
			revokeUrl();
		};
	});

	function onEngine(snapshot: EngineSnapshot) {
		currentTime = snapshot.currentTime;
		playing = snapshot.playing;
		if (!attached || !piece) return;
		if (snapshot.duration > 0 && Math.abs(piece.duration - snapshot.duration) > 0.25) {
			commit((current) => ({ ...current, duration: snapshot.duration }));
		}
	}

	function revokeUrl() {
		if (!objectUrl) return;
		URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	}

	function commit(updater: (current: Piece) => Piece) {
		if (!piece) return;
		const next = mutatePiece(piece.id, updater);
		if (next) piece = next;
	}

	async function connect(file: File, token: number) {
		if (!engine) return;
		revokeUrl();
		objectUrl = URL.createObjectURL(file);
		engine.load(objectUrl);
		attached = true;
		peaks = null;
		peaksStatus = 'loading';
		try {
			const next = await computePeaks(file);
			if (token !== attachToken) return;
			peaks = next;
			peaksStatus = 'ready';
			if (piece && next.duration > 0 && Math.abs(piece.duration - next.duration) > 0.25) {
				commit((current) => ({ ...current, duration: next.duration }));
			}
		} catch {
			if (token !== attachToken) return;
			peaksStatus = 'error';
		}
	}

	async function chooseFile() {
		enablePlaybackSession();
		const result = await pickAudioFile();
		if (result.kind === 'file') await ingest(result.file);
		else if (result.kind === 'fallback') fileInput?.click();
	}

	async function onFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) await ingest(file);
	}

	async function ingest(file: File) {
		if (!piece) return;
		if (!isAudioFile(file)) {
			status = NOT_AUDIO_MESSAGE;
			return;
		}
		enablePlaybackSession();
		busy = true;
		status = 'Reading audio…';
		mismatchName = '';
		try {
			const hash = await hashFile(file);
			if (!piece || hash !== piece.fileHash) {
				const other = hash ? findByHash(hash) : null;
				if (other && !other.deletedAt) {
					rememberFile(hash, file);
					await goto(`/player/${other.id}`);
					return;
				}
				pendingFile = file;
				mismatchName = file.name;
				status = '';
				return;
			}
			rememberFile(hash, file);
			loadedHash = hash;
			const token = ++attachToken;
			await connect(file, token);
			status = '';
		} catch {
			status = 'Could not read that audio file.';
		} finally {
			busy = false;
		}
	}

	async function importMismatch() {
		if (!pendingFile) return;
		busy = true;
		try {
			const created = await openAudioFile(pendingFile);
			await goto(`/player/${created.id}`);
		} catch {
			status = 'Could not open that file.';
		} finally {
			busy = false;
		}
	}

	async function togglePlay() {
		if (!engine || !attached) return;
		enablePlaybackSession();
		try {
			if (playing) engine.pause();
			else await engine.play();
		} catch {
			status = 'Tap play again to start the audio.';
		}
	}

	function playCue(cue: Cue) {
		if (!engine || !attached) {
			status = 'Attach the audio to play from this cue.';
			return;
		}
		enablePlaybackSession();
		status = '';
		void engine.goTo(cue.time).catch(() => {
			status = 'Tap play again to start the audio.';
		});
	}

	function addCue() {
		if (!piece || !attached) return;
		const name = nextCueName(piece.cues);
		const color = smartCueColor(piece.cues, currentTime);
		const time = roundTime(currentTime);
		const stamp = new Date().toISOString();
		let createdId = '';
		commit((current) => {
			const cue: Cue = {
				id: crypto.randomUUID(),
				name,
				time,
				color,
				createdAt: stamp,
				updatedAt: stamp
			};
			createdId = cue.id;
			return { ...current, cues: [...current.cues, cue] };
		});
		editingCueId = createdId;
	}

	function moveCue(id: string, time: number) {
		const nextTime = roundTime(clamp(time, 0, piece?.duration || time));
		commit((current) => ({
			...current,
			cues: current.cues.map((cue) =>
				cue.id === id ? { ...cue, time: nextTime, updatedAt: new Date().toISOString() } : cue
			)
		}));
	}

	function renameCue(id: string, name: string) {
		const nextName = name.trim() || 'Cue';
		commit((current) => ({
			...current,
			cues: current.cues.map((cue) =>
				cue.id === id ? { ...cue, name: nextName, updatedAt: new Date().toISOString() } : cue
			)
		}));
		if (editingCueId === id) editingCueId = null;
	}

	function deleteCue(id: string) {
		commit((current) => ({ ...current, cues: current.cues.filter((cue) => cue.id !== id) }));
		if (editingCueId === id) editingCueId = null;
	}

	function changeColorCue(id: string, color: string) {
		commit((current) => ({
			...current,
			cues: current.cues.map((cue) =>
				cue.id === id ? { ...cue, color, updatedAt: new Date().toISOString() } : cue
			)
		}));
	}

	function renameTitle(value: string) {
		commit((current) => ({ ...current, title: value.trim() || 'Untitled' }));
	}

	function toggleLoop() {
		if (!piece) return;
		commit((current) => ({ ...current, loopEnabled: !current.loopEnabled }));
	}

	function checkTitleOverflow() {
		if (!titleInput) return;
		titleOverflowing = titleInput.scrollWidth > titleInput.clientWidth;
	}

	$effect(() => {
		if (piece?.title && titleInput) {
			checkTitleOverflow();
		}
	});

	$effect(() => {
		if (!titleInput) return;

		const handleResize = () => checkTitleOverflow();
		window.addEventListener('resize', handleResize);
		
		return () => window.removeEventListener('resize', handleResize);
	});

	// Show attach popup when no audio is attached
	$effect(() => {
		showAttachPopup = !attached;
	});

	// Load saved accent color
	$effect(() => {
		const saved = localStorage.getItem('accent-color');
		if (saved) {
			setAccentColor(saved);
		}
	});

	function setAccentColor(color: string) {
		const accentColors = [
			{ name: 'Lime', value: '#e2ff57', light: '#f0ff9a' },
			{ name: 'Blue', value: '#57b3ff', light: '#8fd1ff' },
			{ name: 'Purple', value: '#b557ff', light: '#d18fff' },
			{ name: 'Pink', value: '#ff57b3', light: '#ff8fd1' },
			{ name: 'Orange', value: '#ff8f57', light: '#ffb08f' },
			{ name: 'Teal', value: '#57ffb3', light: '#8fffd1' }
		];
		
		const colorInfo = accentColors.find(c => c.value === color);
		if (colorInfo) {
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
		}
	}

	// Touch drag functions
	function onTouchStart(event: TouchEvent) {
		// Only handle if touching the cue list section or its header, not individual cue buttons
		const target = event.target as HTMLElement;
		if (target.closest('button') && !target.closest('.cue-list-header')) {
			return; // Let cue buttons handle their own events
		}

		isDragging = true;
		hasMoved = false;
		dragStartY = event.touches[0].clientY;
		dragStartExpanded = cueListExpanded;
		touchStartTime = Date.now();
		// Don't prevent default yet - let taps work normally
	}

	function onTouchMove(event: TouchEvent) {
		if (!isDragging) return;
		
		const currentY = event.touches[0].clientY;
		const deltaY = Math.abs(dragStartY - currentY);
		
		// If moved more than 10px, consider it a drag (not a tap)
		if (deltaY > 10) {
			hasMoved = true;
			// Now prevent scrolling since we're dragging
			event.preventDefault();
		}
		
		// Only process drag logic if we've moved significantly
		if (hasMoved) {
			const directionDeltaY = dragStartY - currentY; // Positive = drag up, Negative = drag down
			
			// Threshold for toggling (50px drag distance)
			if (Math.abs(directionDeltaY) > 50) {
				if (directionDeltaY > 0 && !dragStartExpanded) {
					// Dragging up from collapsed state
					cueListExpanded = true;
				} else if (directionDeltaY < 0 && dragStartExpanded) {
					// Dragging down from expanded state
					cueListExpanded = false;
				}
			}
		}
	}

	function onTouchEnd(event: TouchEvent) {
		if (!isDragging) return;
		
		// If it was a quick tap without movement, let the click event fire
		const touchDuration = Date.now() - touchStartTime;
		const wasQuickTap = !hasMoved && touchDuration < 300;
		
		if (!wasQuickTap) {
			// Prevent click events for drags, but allow them for taps
			event.preventDefault();
		}
		
		isDragging = false;
		hasMoved = false;
	}
</script>

<svelte:head>
	<title>{piece ? `${piece.title} · Cue Player` : 'Cue Player'}</title>
</svelte:head>

<div class="app-screen player">
	<header class="topbar">
		<a class="back" href="/" aria-label="Library">
			<ArrowLeft size={20} />
		</a>
		{#if piece}
			{#key piece.id}
				<input
					bind:this={titleInput}
					class="title-input"
					class:title-overflowing={titleOverflowing}
					value={piece.title}
					aria-label="Piece title"
					onblur={(event) => renameTitle(event.currentTarget.value)}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.currentTarget.blur();
					}}
					oninput={checkTitleOverflow}
				/>
			{/key}
		{/if}
	</header>

	{#if !piece}
		<main class="scroll">
			<p class="status">This piece is not in the library.</p>
			<a class="btn btn-primary" href="/">Back to library</a>
		</main>
	{:else}
		<div class="player-body">
			<main class="stage">
				{#if mismatchName}
					<section class="attach">
						<p>{mismatchName} does not match this piece.</p>
						<div class="btn-row">
							<button type="button" class="btn btn-primary" onclick={importMismatch} disabled={busy}>
								Open as its own piece
							</button>
							<button type="button" class="btn" onclick={chooseFile}>Choose another file</button>
						</div>
					</section>
				{/if}

				<!-- Enhanced Waveform with integrated cue controls -->
				<Waveform
					{peaks}
					duration={piece.duration}
					{currentTime}
					cues={orderedCues}
					loopEnabled={piece.loopEnabled}
					loopStart={phrase.start}
					loopEnd={phrase.end}
					onscrub={(time) => engine?.seek(time, { scrubbing: true })}
					onscrubend={() => engine?.endScrub()}
					onmove={moveCue}
				/>

				<div class="status-container">
					{#if peaksStatus === 'loading' || status}
						<div class="status-text">
							{#if peaksStatus === 'loading'}
								Drawing waveform…
							{:else if status}
								{status}
							{/if}
						</div>
					{/if}
				</div>
				
				<div class="clock-row">
					<div class="time-display">
						<p class="clock">
							{formatTime(currentTime)}<span> / {formatTime(piece.duration)}</span>
						</p>
						{#if !attached}
							<button
								type="button" 
								class="btn btn-primary attach-btn"
								onclick={chooseFile}
								disabled={busy}
							>
								{busy ? 'Reading…' : 'Attach audio'}
							</button>
						{/if}
					</div>
					
					<button
						type="button"
						class="add-cue"
						disabled={!attached || piece.duration <= 0}
						onclick={addCue}
					>
						Add cue
					</button>
				</div>
				{#if peaksStatus === 'error'}
					<p class="status">Waveform unavailable. Playback still works.</p>
				{/if}
			</main>

			<!-- Permanent Cue List Section -->
			<section 
				class="cue-list-section" 
				class:expanded={cueListExpanded} 
				data-dragging={isDragging}
				ontouchstart={onTouchStart}
				ontouchmove={onTouchMove}
				ontouchend={onTouchEnd}
			>
				<div 
					class="cue-list-header"
					onclick={(event) => {
						const target = event.target as HTMLElement;
						if (target.closest('button')) return;
						cueListExpanded = !cueListExpanded;
					}}
				>
					<h2>Cues</h2>
					<div class="expand-btn">
						{#if cueListExpanded}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="m6 9 6 6 6-6"/>
							</svg>
						{:else}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="m18 15-6-6-6 6"/>
							</svg>
						{/if}
					</div>
					{#if cueListExpanded}
						<button 
							type="button" 
							class="edit-btn"
							onclick={() => (cueListEditMode = !cueListEditMode)}
						>
							{cueListEditMode ? 'Done' : 'Edit'}
						</button>
					{/if}
				</div>
				<div class="cue-list-container" class:expanded={cueListExpanded}>
					<CueList 
						cues={orderedCues} 
						editMode={cueListEditMode}
						onplay={playCue} 
						onrename={renameCue} 
						ondelete={deleteCue}
						oncolorchange={changeColorCue}
					/>
				</div>
			</section>
		</div>
		<Transport
			{playing}
			rate={piece.rate}
			loopEnabled={piece.loopEnabled}
			endBehavior={piece.endBehavior}
			canPlay={attached}
			hasPrevious={previousCue !== null}
			hasNext={upcomingCue !== null}
			currentTime={currentTime}
			duration={piece.duration}
			onTogglePlay={togglePlay}
			onPrevious={() => previousCue && playCue(previousCue)}
			onNext={() => upcomingCue && playCue(upcomingCue)}
			onRate={(rate) => commit((current) => ({ ...current, rate }))}
			onToggleLoop={toggleLoop}
			onEndBehavior={(endBehavior: EndBehavior) => commit((current) => ({ ...current, endBehavior }))}
			onScrub={(time) => engine?.seek(time, { scrubbing: true })}
			onScrubEnd={() => engine?.endScrub()}
		/>
	{/if}
	<input bind:this={fileInput} type="file" accept={AUDIO_ACCEPT} hidden onchange={onFileInput} />

	<!-- Attach Audio Popup -->
	{#if showAttachPopup}
		<div class="popup-overlay" onclick={() => showAttachPopup = false}>
			<div class="popup-content" onclick={(e) => e.stopPropagation()}>
				<h2>Attach Audio File</h2>
				<p>Attach the audio for this piece. Cues stay saved, and opening the same file brings them back.</p>
				{#if status === NOT_AUDIO_MESSAGE}
					<p class="popup-error">{status}</p>
				{/if}
				<div class="popup-buttons">
					<button type="button" class="btn btn-primary" onclick={chooseFile} disabled={busy}>
						{busy ? 'Reading…' : 'Attach audio'}
					</button>
					<button type="button" class="btn btn-secondary" onclick={() => showAttachPopup = false}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.player {
		/* Containing block for the transport, cue drawer and popup. They are
		   anchored to this shell (position: absolute) rather than the viewport
		   (position: fixed) because the viewport lies about its height on first
		   paint in an iOS home-screen PWA; see --app-height in app.css. */
		position: relative;
		height: var(--app-height);
		max-height: var(--app-height);
		background: linear-gradient(135deg, var(--bg) 0%, var(--accent-rgba-01) 100%);
		overflow: hidden;
		touch-action: none;
		overscroll-behavior: none;
	}

	.player-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.stage {
		padding: 0 24px 0;
		position: relative;
	}

	.attach {
		margin-bottom: 24px;
		padding: 20px 0;
		text-align: center;
	}

	.attach p {
		margin: 0 0 20px;
		color: var(--muted);
		font-size: 1.05rem;
		line-height: 1.5;
	}


	.clock-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin: 8px 0 12px;
		padding: 12px 0;
	}

	.time-display {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.clock {
		margin: 0;
		font-family: var(--mono);
		font-size: 2rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		color: var(--text);
	}

	.clock span {
		color: var(--muted);
		font-size: 1.2rem;
		font-weight: 500;
	}

	.add-cue {
		min-height: 48px;
		padding: 0 24px;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
		color: var(--accent-ink);
		font-weight: 700;
		font-size: 1rem;
		flex: none;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 4px 16px var(--accent-rgba-20);
	}

	.add-cue:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 6px 24px var(--accent-rgba-30);
	}

	.add-cue:disabled {
		background: var(--bg-elev-2);
		color: var(--muted);
		box-shadow: none;
	}

	.attach-btn {
		margin-left: 12px;
	}

	.status-container {
		position: relative;
		height: 0;
	}

	.status-text {
		font-size: 0.75rem;
		color: var(--muted);
		font-weight: 500;
		animation: pulse 2s ease-in-out infinite;
		text-align: center;
		position: absolute;
		top: -16px;
		left: 0;
		right: 0;
		z-index: 2;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}

	.attach-btn {
		margin-left: 16px;
	}

	.cue-list-section {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(188px + var(--safe-bottom)); /* Match transport height exactly */
		z-index: 5;
		display: flex;
		flex-direction: column;
		padding: 20px 20px 0;
		background: color-mix(in srgb, var(--bg) 100%, white 3%);
		border: 1px solid rgba(255, 255, 255, 0.02);
		border-bottom: none;
		border-radius: 20px 20px 0 0;
		transition: all 0.3s ease;
		overflow: hidden;
		cursor: pointer;
		/* Prevent scroll interference during drag */
		touch-action: none;
		overscroll-behavior: contain;
		/* Let collapsed height be determined by content */
		height: auto;
		max-height: 58px; /* Just enough for header (38px) + top padding (20px) */
	}

	.cue-list-section.expanded {
		top: 74px;
		bottom: calc(188px + var(--safe-bottom)); /* Keep same bottom position */
		height: auto; /* Fill between top and bottom */
		max-height: none; /* Remove collapsed height limit */
		border-radius: 0;
		border-left: none;
		border-right: none;
	}

	.cue-list-header {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		margin-bottom: 16px;
	}

	.cue-list-header h2 {
		justify-self: start;
	}

	.cue-list-header .expand-btn {
		justify-self: center;
	}

	.cue-list-header .edit-btn {
		justify-self: end;
	}

	.cue-list-header h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 650;
		color: var(--text);
		letter-spacing: -0.02em;
	}

	.edit-btn {
		padding: 8px 16px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.2s ease;
	}

	.edit-btn:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: var(--accent-rgba-30);
		transform: translateY(-1px);
	}

	.cue-list-container {
		flex: 1;
		overflow: auto;
		padding: 4px 0;
		touch-action: pan-y;
		overscroll-behavior: contain;
	}

	/* Hide cue list content when collapsed */
	.cue-list-section:not(.expanded) .cue-list-container {
		display: none;
	}

	/* Disable scrolling during drawer drag */
	.cue-list-section[data-dragging="true"] .cue-list-container {
		touch-action: none;
		overflow: hidden;
	}

	.expand-btn {
		color: var(--text);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
		opacity: 0.7;
	}

	.cue-list-section:hover .expand-btn {
		opacity: 1;
		transform: scale(1.1);
	}

	.status {
		margin: 16px 0;
		padding: 16px 20px;
		border-radius: 16px;
		background: var(--bg-elev);
		border-left: 4px solid var(--accent);
		font-size: 0.95rem;
	}


	/* Enhanced topbar styling for player */
	.player .topbar {
		background: linear-gradient(135deg, var(--bg) 0%, var(--accent-rgba-02) 100%);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		backdrop-filter: blur(12px);
	}

	.back {
		background: linear-gradient(135deg, var(--bg-elev) 0%, var(--bg-elev-2) 100%);
		border: 1px solid rgba(255, 255, 255, 0.08);
		transition: all 0.2s ease;
	}

	.back:hover {
		transform: translateY(-1px);
		border-color: var(--accent-rgba-20);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}

	.title-input {
		font-size: 1.25rem;
		font-weight: 650;
		border-bottom-color: var(--accent-rgba-20);
		transition: border-color 0.2s ease;
		overflow: hidden;
		white-space: nowrap;
	}

	.title-input.title-overflowing {
		-webkit-mask: linear-gradient(to right, black 0%, black 85%, transparent 100%);
		mask: linear-gradient(to right, black 0%, black 85%, transparent 100%);
	}

	.title-input:focus {
		border-bottom-color: var(--accent-rgba-20);
		outline: none;
	}

	/* Attach Audio Popup */
	.popup-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.popup-content {
		background: var(--bg-elev);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 20px;
		padding: 32px;
		max-width: 400px;
		width: 90%;
		text-align: center;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.popup-content h2 {
		margin: 0 0 16px;
		font-size: 1.3rem;
		font-weight: 650;
		color: var(--text);
	}

	.popup-content p {
		margin: 0 0 24px;
		color: var(--muted);
		line-height: 1.5;
	}

	.popup-content .popup-error {
		margin-top: -12px;
		color: var(--danger);
	}

	.popup-buttons {
		display: flex;
		gap: 12px;
		justify-content: center;
	}
</style>
