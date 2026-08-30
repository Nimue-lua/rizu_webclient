import assert from "node:assert/strict";
import test from "node:test";
import { SongPreviewPlayer } from "../src/audio/SongPreviewPlayer";

class FakeAudio extends EventTarget {
  currentTime = 0;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  readyState = 3;
  src = "";
  volume = 0;
  pause_count = 0;
  load_count = 0;
  play_count = 0;
  play_promise: Promise<void> = Promise.resolve();

  pause(): void {
    this.pause_count += 1;
  }

  play(): Promise<void> {
    this.play_count += 1;
    return this.play_promise;
  }

  load(): void {
    this.load_count += 1;
  }

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
}

const original_window = globalThis.window;
const original_request_animation_frame = globalThis.requestAnimationFrame;
const original_cancel_animation_frame = globalThis.cancelAnimationFrame;

function installBrowserTimers(): void {
  Object.assign(globalThis, {
    window: globalThis,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
  });
}

function restoreBrowserTimers(): void {
  Object.assign(globalThis, {
    window: original_window,
    requestAnimationFrame: original_request_animation_frame,
    cancelAnimationFrame: original_cancel_animation_frame,
  });
}

test("stop invalidates pending playback and clears both audio elements", async () => {
  installBrowserTimers();
  try {
    const first = new FakeAudio();
    const second = new FakeAudio();
    let resolve_play: (() => void) | undefined;
    second.play_promise = new Promise((resolve) => { resolve_play = resolve; });
    const player = new SongPreviewPlayer([first, second] as unknown as [HTMLAudioElement, HTMLAudioElement]);

    player.unlock();
    player.select("chart-1", "song.mp3", 12);
    assert.equal(second.play_count, 1);
    assert.equal(second.currentTime, 12);

    player.stop();
    resolve_play?.();
    await Promise.resolve();

    assert.equal(first.src, "");
    assert.equal(second.src, "");
    assert.ok(first.pause_count > 0);
    assert.ok(second.pause_count > 0);
    assert.equal(first.load_count, 1);
    assert.equal(second.load_count, 1);
  } finally {
    restoreBrowserTimers();
  }
});

test("pause prevents a locked preview from starting later", () => {
  installBrowserTimers();
  try {
    const first = new FakeAudio();
    const second = new FakeAudio();
    const player = new SongPreviewPlayer([first, second] as unknown as [HTMLAudioElement, HTMLAudioElement]);

    player.select("chart-1", "song.mp3", 5);
    assert.equal(second.play_count, 0);
    player.pause();
    player.unlock();

    assert.equal(second.play_count, 0);
    assert.equal(second.src, "song.mp3");
    assert.ok(first.pause_count > 0);
    assert.ok(second.pause_count > 0);
  } finally {
    restoreBrowserTimers();
  }
});

test("selecting another chart from the same set leaves its preview playing", async () => {
  installBrowserTimers();
  try {
    const first = new FakeAudio();
    const second = new FakeAudio();
    const player = new SongPreviewPlayer([first, second] as unknown as [HTMLAudioElement, HTMLAudioElement]);

    player.unlock();
    player.select("song-set-1", "first-url.mp3", 10);
    await Promise.resolve();
    player.select("song-set-1", "replacement-url.mp3", 20);

    assert.equal(second.play_count, 1);
    assert.equal(second.src, "first-url.mp3");
    assert.equal(first.play_count, 0);
  } finally {
    restoreBrowserTimers();
  }
});
