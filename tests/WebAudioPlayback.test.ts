import assert from "node:assert/strict";
import test from "node:test";
import { WebAudioPlayback } from "../src/gameplay/audio/WebAudioPlayback";

class FakeGain {
  readonly gain = { value: 1 };
  disconnect_calls = 0;
  connect(): AudioNode { return {} as AudioNode; }
  disconnect(): void { this.disconnect_calls += 1; }
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  readonly playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  start_args: [number, number] | null = null;
  stop_calls = 0;
  disconnect_calls = 0;
  connect(gain: GainNode): GainNode { return gain; }
  start(time: number, offset = 0): void { this.start_args = [time, offset]; }
  stop(): void { this.stop_calls += 1; }
  disconnect(): void { this.disconnect_calls += 1; }
}

function createPlayback(output_timestamp: () => AudioTimestamp = () => ({ contextTime: 10, performanceTime: 1000 }),
  performance_now?: () => number) {
  let now = 1000;
  let resumes = 0;
  let suspends = 0;
  const gain = new FakeGain();
  const sources: FakeSource[] = [];
  const context = {
    currentTime: 10,
    destination: {} as AudioDestinationNode,
    createGain: () => gain as unknown as GainNode,
    createBufferSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    },
    getOutputTimestamp: output_timestamp,
    resume: async () => { resumes += 1; },
    suspend: async () => { suspends += 1; },
  } as unknown as AudioContext & { currentTime: number };
  const playback = new WebAudioPlayback({
    audio_context: context,
    audio_buffer: {} as AudioBuffer,
    volume: 0.5,
    rate: 1,
    performance_now: performance_now ?? (() => now),
  });
  return { playback, context, gain, sources, setNow: (value: number) => { now = value; },
    resumes: () => resumes, suspends: () => suspends };
}

test("schedules Web Audio with lead-in and reports timestamped media position", () => {
  const harness = createPlayback();
  harness.playback.start(0.7);
  assert.deepEqual(harness.sources[0]?.start_args, [10.7, 0]);
  assert.equal(harness.gain.gain.value, 0.5);
  const sample = harness.playback.samplePosition();
  assert.ok(sample && Math.abs(sample.position + 0.7) < 1e-12);
  assert.equal(sample.performance_time, 1000);
  assert.equal(harness.resumes(), 1);
});

test("falls back to currentTime paired with the performance midpoint", () => {
  const values = [100, 104];
  const fallback = createPlayback(() => { throw new Error("unsupported"); }, () => values.shift()!);
  fallback.playback.start(0);
  const first = fallback.playback.samplePosition();
  assert.equal(first?.position, 0);
  assert.equal(first?.performance_time, 102);
});

test("seek, restart, and rate changes recreate one-shot sources", () => {
  const harness = createPlayback();
  harness.playback.start(0);
  harness.playback.seek(0.25);
  assert.deepEqual(harness.sources[1]?.start_args, [10, 0.25]);
  harness.playback.restart(0.5);
  assert.deepEqual(harness.sources[2]?.start_args, [10.5, 0]);
  harness.playback.setRate(2);
  assert.equal(harness.sources[3]?.playbackRate.value, 2);
  assert.deepEqual(harness.sources[3]?.start_args, [10.25, 0]);
});

test("pause, resume, volume, end, and destroy control only playback resources", () => {
  const harness = createPlayback();
  harness.playback.start(0);
  harness.playback.pause();
  harness.playback.resume();
  harness.playback.setVolume(0.25);
  assert.equal(harness.gain.gain.value, 0.25);
  assert.equal(harness.suspends(), 1);
  assert.equal(harness.resumes(), 2);
  harness.playback.end();
  assert.equal(harness.sources[0]?.stop_calls, 1);
  harness.playback.destroy();
  harness.playback.destroy();
  assert.equal(harness.gain.disconnect_calls, 1);
});
