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
	if (navigator.audioSession) navigator.audioSession.type = 'playback';
}

export class AudioEngine {
	readonly audio = new Audio();
	private listeners = new Set<Listener>();
	private raf = 0;
	private wakeLock: WakeLockSentinel | null = null;
	private displayedTime: number | null = null;
	private armedFrom = 0;
	private scrubbing = false;
	private loopEnabled = false;
	private phraseStart: number | null = null;
	private stoppedAt: number | null = null;
	private endBehavior: EndBehavior = 'playThrough';
	private cueTimes: number[] = [];
	private rate = 1;
	private onVisibility = () => {
		if (document.visibilityState === 'visible' && !this.audio.paused) {
			void this.acquireWakeLock();
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

	async play(): Promise<void> {
		enablePlaybackSession();
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
		await this.audio.play();
		this.startRaf();
		void this.acquireWakeLock();
		this.emit();
	}

	pause(): void {
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
		this.scrubbing = Boolean(options?.scrubbing);
		this.displayedTime = next;
		this.armedFrom = next;
		if (Number.isFinite(this.audio.duration)) this.audio.currentTime = next;
		this.emit();
	}

	endScrub(): void {
		this.scrubbing = false;
		this.armedFrom = this.time();
	}

	setRate(rate: number): void {
		this.rate = clamp(rate, 0.5, 1.5);
		this.applyRate();
	}

	setLoop(enabled: boolean): void {
		this.loopEnabled = enabled;
	}

	setEndBehavior(behavior: EndBehavior): void {
		this.endBehavior = behavior;
	}

	setCueTimes(times: number[]): void {
		this.cueTimes = [...times].filter((time) => Number.isFinite(time)).sort((a, b) => a - b);
	}

	destroy(): void {
		this.pause();
		this.audio.removeEventListener('play', this.onPlay);
		this.audio.removeEventListener('pause', this.onPause);
		this.audio.removeEventListener('ended', this.onEnded);
		this.audio.removeEventListener('seeked', this.onSeeked);
		this.audio.removeEventListener('loadedmetadata', this.onMetadata);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.audio.removeAttribute('src');
		this.audio.load();
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
		if (this.endBehavior === 'stopAtCue' && !this.loopEnabled) {
			this.latchPhrase(this.armedFrom, this.duration());
		}
		this.onPause();
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
		if (this.displayedTime != null && Math.abs(this.audio.currentTime - this.displayedTime) < 0.08) {
			this.displayedTime = null;
		}
		this.emit();
	};

	private duration(): number {
		return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
	}

	private time(): number {
		if (this.displayedTime == null) return this.audio.currentTime || 0;
		if (Math.abs((this.audio.currentTime || 0) - this.displayedTime) < 0.08) {
			this.displayedTime = null;
			return this.audio.currentTime || 0;
		}
		return this.displayedTime;
	}

	private snapshot(): EngineSnapshot {
		return {
			currentTime: this.time(),
			duration: this.duration(),
			playing: !this.audio.paused && !this.audio.ended
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
			const bounds = phraseBounds(t, this.cueTimes, this.duration() || t);
			if (bounds.end > bounds.start + 0.05 && t >= bounds.end - lookahead) {
				this.audio.currentTime = bounds.start;
				this.displayedTime = bounds.start;
				this.armedFrom = bounds.start;
			}
			return;
		}

		if (this.endBehavior !== 'stopAtCue') return;
		const bounds = phraseBounds(this.armedFrom, this.cueTimes, this.duration() || this.armedFrom);
		const endsAtCue = this.cueTimes.some((cue) => Math.abs(cue - bounds.end) < 0.02);
		if (!endsAtCue || bounds.end <= bounds.start + 0.05 || t < bounds.end - lookahead) return;
		this.latchPhrase(this.armedFrom, bounds.end);
		this.displayedTime = bounds.end;
		this.armedFrom = bounds.end;
		this.audio.currentTime = bounds.end;
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
