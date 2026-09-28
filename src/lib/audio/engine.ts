import { phraseBounds } from '$lib/cues/phrase';
import type { EndBehavior } from '$lib/storage/types';
import { clamp } from '$lib/format';

export interface EngineSnapshot {
	currentTime: number;
	duration: number;
	playing: boolean;
}

type Listener = (snapshot: EngineSnapshot) => void;

export function enablePlaybackSession(): void {
	const session = navigator.audioSession;
	if (session && session.type !== 'playback') session.type = 'playback';
}

export class AudioEngine {
	readonly audio = new Audio();
	private listeners = new Set<Listener>();
	private raf = 0;
	private wakeLock: WakeLockSentinel | null = null;
	/** Target of a seek the element has not confirmed yet; shown instead of audio.currentTime. */
	private displayedTime: number | null = null;
	/** Latest position requested. May be ahead of the element while a seek is in flight. */
	private seekTarget: number | null = null;
	/** True between assigning audio.currentTime and the matching `seeked` event. */
	private seekPending = false;
	private seekAttempts = 0;
	private seekTimer = 0;
	/** Playback was interrupted by a scrub and should resume when the seek lands. */
	private resumeAfterScrub = false;
	/** Where the current phrase was entered; transport rules measure the phrase from here. */
	private armedFrom = 0;
	private scrubbing = false;
	private loopEnabled = false;
	private phraseStart: number | null = null;
	private stoppedAt: number | null = null;
	private endBehavior: EndBehavior = 'playThrough';
	private cueTimes: number[] = [];
	private rate = 1;
	/** See keepSessionWarm(). */
	private warmContext: AudioContext | null = null;
	private onVisibility = () => {
		if (document.visibilityState === 'visible') {
			if (!this.audio.paused) void this.acquireWakeLock();
			if (this.warmContext) void this.warmContext.resume().catch(() => {});
		} else if (this.warmContext) {
			void this.warmContext.suspend().catch(() => {});
		}
	};

	constructor() {
		this.audio.preload = 'auto';
		this.audio.preservesPitch = true;
		(this.audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
		this.audio.addEventListener('play', this.onPlay);
		this.audio.addEventListener('pause', this.onPause);
		this.audio.addEventListener('ended', this.onEnded);
		this.audio.addEventListener('seeked', this.onSeeked);
		this.audio.addEventListener('timeupdate', this.onTimeUpdate);
		this.audio.addEventListener('loadedmetadata', this.onMetadata);
		document.addEventListener('visibilitychange', this.onVisibility);
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot());
		return () => this.listeners.delete(listener);
	}

	load(url: string): void {
		this.displayedTime = 0;
		this.armedFrom = 0;
		this.audio.src = url;
		this.audio.load();
		this.emit();
	}

	play(): Promise<void> {
		enablePlaybackSession();
		this.keepSessionWarm();
		if (
			this.endBehavior === 'stopAtCue' &&
			this.stoppedAt != null &&
			Math.abs(this.time() - this.stoppedAt) <= 0.05
		) {
			const start = this.phraseStart ?? 0;
			this.stoppedAt = null;
			this.phraseStart = null;
			this.seek(start);
		}
		this.armedFrom = this.time();
		// audio.play() flips `paused` synchronously but its promise only settles
		// once the pipeline is actually producing sound. Emit now so the UI
		// reacts on the tap itself rather than waiting for the media stack.
		const started = this.audio.play();
		this.startRaf();
		void this.acquireWakeLock();
		this.emit();
		return started.catch((error: unknown) => {
			// Autoplay refused or the element failed to start: roll the UI back.
			this.stopRaf();
			this.emit();
			throw error;
		});
	}

	/**
	 * Keep the platform audio session active between plays. On iOS WebKit a
	 * paused media element lets the session go idle, and the next play() has to
	 * re-activate it, which adds a variable delay before sound starts. A running
	 * AudioContext (even with nothing connected) keeps the output route open so
	 * resuming is immediate. Must first be called from a user gesture.
	 */
	private keepSessionWarm(): void {
		try {
			if (!this.warmContext) this.warmContext = new AudioContext();
			if (this.warmContext.state !== 'running') {
				void this.warmContext.resume().catch(() => {});
			}
		} catch {
			this.warmContext = null;
		}
	}

	pause(): void {
		this.resumeAfterScrub = false;
		this.audio.pause();
		this.stopRaf();
		void this.releaseWakeLock();
		this.emit();
	}

	async goTo(time: number): Promise<void> {
		const wasPlaying = !this.audio.paused && !this.audio.ended;
		this.seek(time);
		if (wasPlaying) await this.play();
	}

	seek(time: number, options?: { scrubbing?: boolean }): void {
		const duration = this.duration();
		const next = clamp(time, 0, duration || time);
		if (this.stoppedAt == null || Math.abs(next - this.stoppedAt) > 0.05) {
			this.stoppedAt = null;
			this.phraseStart = null;
		}
		const scrubbing = Boolean(options?.scrubbing);
		// A burst of currentTime writes wedges the media element: it stays
		// "playing" but produces no sound. Pause for the gesture and let only
		// one seek run at a time.
		if (scrubbing && !this.scrubbing && !this.audio.paused && !this.audio.ended) {
			this.resumeAfterScrub = true;
			this.audio.pause();
		}
		this.scrubbing = scrubbing;
		this.setPosition(next);
		this.emit();
	}

	endScrub(): void {
		this.scrubbing = false;
		this.applySeek();
		this.armedFrom = this.time();
		this.resumeIfNeeded();
	}

	setRate(rate: number): void {
		this.rate = clamp(rate, 0.5, 1.5);
		this.applyRate();
	}

	setLoop(enabled: boolean): void {
		this.loopEnabled = enabled;
		// Loop the phrase the playhead is in now, not the one playback started in.
		if (enabled) this.armedFrom = this.time();
	}

	setEndBehavior(behavior: EndBehavior): void {
		this.endBehavior = behavior;
	}

	setCueTimes(times: number[]): void {
		const next = [...times].filter((time) => Number.isFinite(time)).sort((a, b) => a - b);
		const changed =
			next.length !== this.cueTimes.length || next.some((time, i) => time !== this.cueTimes[i]);
		this.cueTimes = next;
		// The phrase structure changed under the playhead; measure from where it is now.
		if (changed) this.armedFrom = this.time();
	}

	destroy(): void {
		this.pause();
		this.audio.removeEventListener('play', this.onPlay);
		this.audio.removeEventListener('pause', this.onPause);
		this.audio.removeEventListener('ended', this.onEnded);
		this.audio.removeEventListener('seeked', this.onSeeked);
		this.audio.removeEventListener('timeupdate', this.onTimeUpdate);
		this.audio.removeEventListener('loadedmetadata', this.onMetadata);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.audio.removeAttribute('src');
		this.audio.load();
		window.clearTimeout(this.seekTimer);
		this.seekTimer = 0;
		void this.warmContext?.close().catch(() => {});
		this.warmContext = null;
		this.listeners.clear();
	}

	private onPlay = () => {
		this.startRaf();
		this.emit();
	};

	private onPause = () => {
		this.stopRaf();
		void this.releaseWakeLock();
		this.emit();
	};

	private onEnded = () => {
		if (this.loopEnabled) {
			// The last phrase runs to the end of the file; if a late tick let the
			// element reach it, restart the phrase instead of stopping.
			const bounds = phraseBounds(this.armedFrom, this.cueTimes, this.duration());
			this.setPosition(bounds.start);
			void this.play().catch(() => this.onPause());
			return;
		}
		if (this.endBehavior === 'stopAtCue') {
			this.latchPhrase(this.armedFrom, this.duration());
		}
		this.onPause();
	};

	/** Fires ~4×/s from the element itself, so transport rules still run when rAF is throttled. */
	private onTimeUpdate = () => {
		if (this.audio.paused) return;
		this.applyTransportRules();
		this.emit();
	};

	private latchPhrase(origin: number, stoppedAt: number): void {
		const bounds = phraseBounds(origin, this.cueTimes, this.duration() || origin);
		this.phraseStart = bounds.start;
		this.stoppedAt = stoppedAt;
	}

	private onMetadata = () => {
		this.applyRate();
		this.emit();
	};

	private applyRate(): void {
		this.audio.preservesPitch = true;
		(this.audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
		this.audio.playbackRate = this.rate;
	}

	private onSeeked = () => {
		if (this.seekTarget != null && Math.abs(this.audio.currentTime - this.seekTarget) >= 0.08) {
			this.seekPending = false;
			// seeked can fire inside the currentTime assignment. Apply the newer
			// target on a later turn so this cannot recurse.
			queueMicrotask(() => {
				this.applySeek();
				this.emit();
			});
			return;
		}
		this.finishSeek();
		this.emit();
		this.resumeIfNeeded();
	};

	/** Move the displayed playhead immediately, and seek the element when it is free. */
	private setPosition(time: number): void {
		this.displayedTime = time;
		this.armedFrom = time;
		if (!Number.isFinite(this.audio.duration)) return;
		this.seekTarget = time;
		this.applySeek();
	}

	private applySeek(): void {
		if (this.seekTarget == null || !Number.isFinite(this.audio.duration)) return;
		if (Math.abs(this.audio.currentTime - this.seekTarget) < 0.05 && !this.audio.seeking) {
			this.finishSeek();
			return;
		}
		// One seek at a time. The latest target is kept and applied when this one lands.
		if (this.audio.seeking || this.seekPending) {
			this.armSeekWatchdog();
			return;
		}
		const target = this.seekTarget;
		this.seekPending = true;
		this.audio.currentTime = target;
		if (this.seekPending) this.armSeekWatchdog();
	}

	private finishSeek(): void {
		window.clearTimeout(this.seekTimer);
		this.seekTimer = 0;
		this.seekAttempts = 0;
		this.seekPending = false;
		this.displayedTime = null;
		this.seekTarget = null;
	}

	private armSeekWatchdog(): void {
		window.clearTimeout(this.seekTimer);
		this.seekTimer = window.setTimeout(() => this.recoverSeek(), 500);
	}

	/** A seek that never settles leaves the element silent while play() still toggles. */
	private recoverSeek(): void {
		this.seekTimer = 0;
		if (this.seekTarget == null) return;
		if (!this.audio.seeking && Math.abs(this.audio.currentTime - this.seekTarget) < 0.08) {
			this.finishSeek();
			this.emit();
			this.resumeIfNeeded();
			return;
		}
		this.seekAttempts += 1;
		this.seekPending = false;
		if (this.seekAttempts > 2) {
			const target = this.seekTarget;
			this.audio.pause();
			this.seekAttempts = 0;
			try {
				this.audio.currentTime = target;
			} catch {
				// The element can reject a seek while wedged; the next attempt retries.
			}
			this.seekPending = true;
			this.armSeekWatchdog();
			this.emit();
			return;
		}
		this.applySeek();
		if (this.seekPending) this.armSeekWatchdog();
	}

	private resumeIfNeeded(): void {
		if (!this.resumeAfterScrub || this.scrubbing || this.seekPending) return;
		this.resumeAfterScrub = false;
		void this.play();
	}

	private duration(): number {
		return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
	}

	private time(): number {
		const actual = this.audio.currentTime || 0;
		if (this.displayedTime == null) return actual;
		// Hold the requested position only while the element is still catching up
		// (seek in flight, or metadata not loaded yet). Never hold it indefinitely.
		const waiting = this.seekPending || !Number.isFinite(this.audio.duration);
		if (waiting && Math.abs(actual - this.displayedTime) >= 0.08) return this.displayedTime;
		this.displayedTime = null;
		return actual;
	}

	private snapshot(): EngineSnapshot {
		return {
			currentTime: this.time(),
			duration: this.duration(),
			playing: this.resumeAfterScrub || (!this.audio.paused && !this.audio.ended)
		};
	}

	private emit = () => {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	};

	private startRaf(): void {
		this.stopRaf();
		const tick = () => {
			this.applyTransportRules();
			this.emit();
			if (!this.audio.paused) this.raf = requestAnimationFrame(tick);
		};
		this.raf = requestAnimationFrame(tick);
	}

	private stopRaf(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private applyTransportRules(): void {
		if (this.scrubbing || this.audio.paused) return;
		const t = this.time();
		const rate = this.audio.playbackRate || 1;
		const lookahead = 0.035 * rate;

		if (this.loopEnabled) {
			// Measure from the phrase we entered, not from `t`: if a tick arrives late
			// and `t` is already past the cue, phraseBounds(t) would describe the
			// next phrase and the loop would quietly drift forward.
			const bounds = phraseBounds(this.armedFrom, this.cueTimes, this.duration() || t);
			if (t < bounds.start - 0.05 || t > bounds.end + 1) {
				// Playback moved somewhere we didn't send it (e.g. while suspended). Re-arm here.
				this.armedFrom = t;
				return;
			}
			if (bounds.end > bounds.start + 0.05 && t >= bounds.end - lookahead) {
				this.setPosition(bounds.start);
			}
			return;
		}

		if (this.endBehavior !== 'stopAtCue') return;
		const bounds = phraseBounds(this.armedFrom, this.cueTimes, this.duration() || this.armedFrom);
		const endsAtCue = this.cueTimes.some((cue) => Math.abs(cue - bounds.end) < 0.02);
		if (!endsAtCue || bounds.end <= bounds.start + 0.05 || t < bounds.end - lookahead) return;
		this.latchPhrase(this.armedFrom, bounds.end);
		this.setPosition(bounds.end);
		this.audio.pause();
	}

	private async acquireWakeLock(): Promise<void> {
		try {
			if (!this.wakeLock || this.wakeLock.released) {
				this.wakeLock = await navigator.wakeLock.request('screen');
			}
		} catch {
			this.wakeLock = null;
		}
	}

	private async releaseWakeLock(): Promise<void> {
		try {
			await this.wakeLock?.release();
		} catch {
			// Already released.
		}
		this.wakeLock = null;
	}
}
