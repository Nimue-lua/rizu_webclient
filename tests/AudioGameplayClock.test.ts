import assert from "node:assert/strict";
import test from "node:test";
import { AudioGameplayClock } from "../src/gameplay/AudioGameplayClock";
import type { AudioPlaybackPosition } from "../src/gameplay/audio/AudioPlayback";

interface ClockHarness {
  clock: AudioGameplayClock;
  setNow(value: number): void;
  setSample(position: number, performance_time?: number): void;
}

function createClock(options: { rate?: number; offset?: number; correction?: number; snap?: number } = {}): ClockHarness {
  let now = 1000;
  let sample: AudioPlaybackPosition | null = { position: 0, performance_time: 1000 };
  const clock = new AudioGameplayClock({
    rate: options.rate ?? 1,
    music_offset_ms: options.offset ?? 0,
    correction_factor: options.correction,
    snap_threshold_seconds: options.snap,
    performance_now: () => now,
    sample_audio_position: () => sample,
  });
  return {
    clock,
    setNow: (value) => { now = value; },
    setSample: (position, performance_time = now) => { sample = { position, performance_time }; },
  };
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test("extrapolates smoothly while repeated audio samples remain unchanged", () => {
  const harness = createClock();
  harness.clock.start(0);
  close(harness.clock.timeAt(1000).monotonic, 0);
  close(harness.clock.timeAt(1010).monotonic, 0.01);
  close(harness.clock.timeAt(1020).monotonic, 0.02);
});

test("gradually corrects small positive and negative audio drift", () => {
  const ahead = createClock();
  ahead.clock.start(0);
  ahead.clock.timeAt(1000);
  ahead.setSample(0.12, 1100);
  close(ahead.clock.timeAt(1100).corrected, 0.102);

  const behind = createClock();
  behind.clock.start(0);
  behind.clock.timeAt(1000);
  behind.setSample(0.08, 1100);
  close(behind.clock.timeAt(1100).corrected, 0.098);
});

test("snaps corrected time on large drift while monotonic time does not regress", () => {
  const harness = createClock();
  harness.clock.start(0);
  harness.clock.timeAt(1000);
  harness.setSample(0.5, 1100);
  close(harness.clock.timeAt(1100).corrected, 0.5);
  harness.setSample(0.2, 1200);
  const backward = harness.clock.timeAt(1200);
  close(backward.corrected, 0.2);
  close(backward.monotonic, 0.5);
});

test("lead-in, rate, and music offset use chart-time units", () => {
  const harness = createClock({ rate: 2, offset: 200 });
  harness.clock.start(0.7);
  harness.setSample(-1.4, 1000);
  close(harness.clock.timeAt(1000).corrected, -1);
  close(harness.clock.timeAt(1100).corrected, -0.8);
});

test("pause and resume freeze time without counting paused wall time", () => {
  const harness = createClock();
  harness.clock.start(0);
  harness.clock.timeAt(1100);
  harness.setNow(1100);
  harness.clock.pause();
  close(harness.clock.timeAt(5000).corrected, 0.1);
  harness.setNow(5000);
  harness.setSample(0.1, 5000);
  harness.clock.resume();
  close(harness.clock.timeAt(5100).corrected, 0.2);
});

test("seek and restart reset monotonic and correction history", () => {
  const harness = createClock();
  harness.clock.start(0);
  harness.clock.timeAt(2000);
  harness.setNow(2000);
  harness.clock.seek(0.25);
  harness.setSample(0.25, 2000);
  close(harness.clock.timeAt(2000).monotonic, 0.25);
  harness.setNow(2100);
  harness.clock.restart(0.5);
  harness.setSample(-0.5, 2100);
  close(harness.clock.timeAt(2100).corrected, -0.5);
});

test("rate and offset changes reset interpolation without smoothing", () => {
  const harness = createClock();
  harness.clock.start(0);
  harness.clock.timeAt(1500);
  harness.setNow(1500);
  harness.setSample(0.5, 1500);
  harness.clock.setRate(2);
  close(harness.clock.timeAt(1500).corrected, 0.5);
  harness.clock.setMusicOffset(100);
  harness.setSample(0.5, 1500);
  close(harness.clock.timeAt(1500).corrected, 0.7);
});

test("end stops correction but keeps extrapolating for result delay", () => {
  const harness = createClock();
  harness.clock.start(0);
  harness.clock.timeAt(1000);
  harness.clock.end();
  harness.setSample(10, 1100);
  close(harness.clock.timeAt(1200).monotonic, 0.2);
});
