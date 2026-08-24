export interface AudioPlaybackPosition {
  position: number;
  performance_time: number;
}

export interface AudioPlayback {
  readonly rate: number;
  start(lead_in_seconds: number): void;
  samplePosition(): AudioPlaybackPosition | null;
  pause(): void;
  resume(): void;
  seek(position: number): void;
  restart(lead_in_seconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  end(): void;
  destroy(): void;
}
