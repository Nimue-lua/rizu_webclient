const PREVIEW_DEBOUNCE_MS = 200;
const PREVIEW_DUCK_MS = 180;
const PREVIEW_CROSSFADE_MS = 300;

export class SongPreviewPlayer {
  private readonly audio: readonly [HTMLAudioElement, HTMLAudioElement];
  private active_index = 0;
  private gains: [number, number] = [0, 0];
  private volume = 1;
  private playback_rate = 1;
  private request = 0;
  private unlocked = false;
  private pending_start: (() => void) | null = null;
  private fade_frame: number | null = null;
  private debounce_timer: number | null = null;
  private last_change: number | null = null;
  private selected_id: string | null = null;

  constructor(audio: readonly [HTMLAudioElement, HTMLAudioElement] = [new Audio(), new Audio()]) {
    this.audio = audio;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.applyVolumes();
  }

  setPlaybackRate(rate: number): void {
    this.playback_rate = rate;
    for (const audio of this.audio) {
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
    }
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.pending_start?.();
  }

  select(id: string, url: string, preview_time: number): void {
    if (id && id === this.selected_id) return;
    this.selected_id = id || null;
    const request = ++this.request;
    this.pending_start = null;
    this.clearDebounce();
    const ducked_gains: [number, number] = this.active_index === 0 ? [0.5, 0] : [0, 0.5];
    this.fadeTo(ducked_gains, PREVIEW_DUCK_MS);

    const now = performance.now();
    const previous_change = this.last_change;
    this.last_change = now;
    const switch_preview = () => {
      this.debounce_timer = null;
      if (request !== this.request) return;
      if (!url) {
        this.stop(PREVIEW_CROSSFADE_MS);
        return;
      }

      const previous_index = this.active_index;
      const next_index = previous_index === 0 ? 1 : 0;
      const previous_audio = this.audio[previous_index];
      const next_audio = this.audio[next_index];
      next_audio.pause();
      next_audio.src = url;
      next_audio.defaultPlaybackRate = this.playback_rate;
      next_audio.playbackRate = this.playback_rate;
      next_audio.volume = 0;
      this.gains[next_index] = 0;

      let started = false;
      const stop_failed_preview = () => {
        if (request !== this.request) return;
        this.selected_id = null;
        this.fadeTo([0, 0], PREVIEW_CROSSFADE_MS, () => previous_audio.pause());
      };
      const start_playback = () => {
        if (started || request !== this.request) return;
        if (!this.unlocked) {
          this.pending_start = start_playback;
          return;
        }
        started = true;
        this.pending_start = null;
        next_audio.currentTime = preview_time;
        void next_audio.play().then(() => {
          if (request !== this.request) {
            next_audio.pause();
            return;
          }
          this.active_index = next_index;
          this.fadeTo(next_index === 0 ? [1, 0] : [0, 1], PREVIEW_CROSSFADE_MS, () => {
            if (request !== this.request) return;
            this.clearAudio(previous_audio);
          });
        }).catch(stop_failed_preview);
      };

      if (next_audio.readyState >= 3) start_playback();
      else next_audio.addEventListener("canplay", start_playback, { once: true });
      next_audio.addEventListener("error", stop_failed_preview, { once: true });
    };

    if (previous_change === null || now - previous_change >= PREVIEW_DEBOUNCE_MS) switch_preview();
    else this.debounce_timer = window.setTimeout(switch_preview, PREVIEW_DEBOUNCE_MS);
  }

  pause(): void {
    ++this.request;
    this.pending_start = null;
    this.clearDebounce();
    this.cancelFade();
    for (const audio of this.audio) audio.pause();
  }

  stop(fade_ms = 0): void {
    ++this.request;
    this.selected_id = null;
    this.pending_start = null;
    this.clearDebounce();
    if (fade_ms > 0) {
      this.fadeTo([0, 0], fade_ms, () => this.clearAllAudio());
      return;
    }
    this.cancelFade();
    this.gains = [0, 0];
    this.clearAllAudio();
  }

  destroy(): void {
    this.stop();
  }

  private fadeTo(targets: [number, number], duration_ms: number, on_complete?: () => void): void {
    this.cancelFade();
    const starts: [number, number] = [...this.gains];
    const started_at = performance.now();
    const update = (time: number) => {
      const progress = duration_ms <= 0 ? 1 : Math.min(Math.max((time - started_at) / duration_ms, 0), 1);
      this.gains = [
        starts[0] + (targets[0] - starts[0]) * progress,
        starts[1] + (targets[1] - starts[1]) * progress,
      ];
      this.applyVolumes();
      if (progress < 1) this.fade_frame = requestAnimationFrame(update);
      else {
        this.fade_frame = null;
        on_complete?.();
      }
    };
    this.fade_frame = requestAnimationFrame(update);
  }

  private applyVolumes(): void {
    for (let index = 0; index < this.audio.length; index += 1) {
      this.audio[index].volume = Math.min(Math.max(this.volume * this.gains[index], 0), 1);
    }
  }

  private cancelFade(): void {
    if (this.fade_frame === null) return;
    cancelAnimationFrame(this.fade_frame);
    this.fade_frame = null;
  }

  private clearDebounce(): void {
    if (this.debounce_timer === null) return;
    window.clearTimeout(this.debounce_timer);
    this.debounce_timer = null;
  }

  private clearAllAudio(): void {
    for (const audio of this.audio) this.clearAudio(audio);
  }

  private clearAudio(audio: HTMLAudioElement): void {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}
