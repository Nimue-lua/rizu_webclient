# Web Client

## Goal

The web client is a browser-based Rizu client focused initially on keyboard VSRG play. It is a toy project until the main game is complete, but its architecture should still preserve rhythm-game timing correctness and support a server library containing tens of thousands of songs.

## Scope

The first version should provide:

- A locally cached, searchable song catalog.
- Keyboard-driven song selection.
- Downloaded chart and audio assets for gameplay.
- Local, deterministic input judgment and replay recording.
- High-refresh-rate gameplay rendered independently from the application UI.
- Result submission after a play has finished.

The first version does not need feature parity with the native client, mobile gameplay, multiplayer synchronization, or offline availability for the entire library.

## Technology Stack

- TypeScript in strict mode.
- React for application screens and non-gameplay UI.
- Vite for the development server and production build.
- WebGL2 for gameplay rendering.
- Web Audio API for gameplay audio and the authoritative song clock.
- HTTP for the catalog, charts, gameplay audio, images, and result submission.
- Short, pre-generated Opus previews streamed over HTTP for song select.
- IndexedDB for catalog data, catalog version information, settings, and selected cached assets.
- Web Workers for expensive catalog indexing, filtering, chart parsing, and decompression when profiling shows that main-thread work is visible.

Dependencies should remain deliberate and limited. A package should solve a demonstrated problem more effectively than a small local implementation. React and Vite are foundational choices; they do not imply adopting a router, state framework, UI kit, rendering engine, or general utility library.

## User Experience

- Opening the client should show the locally cached library immediately when one is available, then synchronize catalog updates in the background.
- Song-list navigation should remain responsive with tens of thousands of entries.
- Confirming a chart should display a loading state until its complete gameplay audio and chart data are available locally.
- Selecting a song should stream its compact preview from the chart's configured preview time.
- Gameplay should not depend on network availability after loading has completed.
- Dropped render frames must not alter judgment timing or cause the gameplay clock to drift.
- Players should be able to calibrate audio, input, and visual offsets.

## Architecture Decisions

### ADR: React Owns Application UI, Not Gameplay State

- React owns login, settings, song select, loading, pause, and results screens.
- The gameplay screen mounts a canvas and creates an imperative gameplay runtime.
- Per-frame values such as song time, visible notes, key state, animations, and judgment state must not flow through React state.
- React may receive low-frequency lifecycle events such as ready, paused, failed, or finished.
- Entering and leaving gameplay must create and destroy a fresh runtime instance, including its event listeners and GPU resources.

### ADR: Gameplay Uses WebGL2

- Gameplay is rendered into one canvas using WebGL2.
- Rendering should batch or instance notes and avoid per-frame DOM updates.
- Parsed chart data should use compact arrays or typed arrays rather than a large graph of mutable per-note objects where practical.
- `requestAnimationFrame` controls presentation only. It is not the gameplay clock and must not drive scoring progression.
- WebGPU and `OffscreenCanvas` are deferred until profiling demonstrates a concrete need.

### ADR: Web Audio Owns Gameplay Time

- Complete gameplay audio is fetched over HTTP and decoded or otherwise made fully ready before play starts.
- Playback is scheduled against `AudioContext.currentTime`.
- Song time is derived from the audio clock and the scheduled start time, with the configured gameplay offset applied.
- Judgment is performed locally against timestamps converted to the same clock domain.
- Browser-reported latency may inform defaults, but manual calibration remains required because hardware and operating-system latency are not fully observable.

### ADR: Gameplay Assets Use HTTP

- Confirming a chart fetches the chart, complete gameplay audio, and required visual assets over HTTP.
- Existing requests should be reused or cached where possible.
- Gameplay starts only after required assets are locally available and the audio clock can be scheduled reliably.
- Scores and replays are submitted only after gameplay; server round trips are never part of hit judgment.

### ADR: Versioned Local Catalog

- The server exposes a compact, versioned catalog containing searchable metadata and stable asset identifiers or URLs.
- The client stores catalog data in IndexedDB.
- On startup, the client renders cached data first and then asks the server for a new snapshot or incremental changes.
- Catalog synchronization must be transactional: a failed update must not destroy the last usable local catalog.
- Covers, charts, full audio, and other heavy assets are fetched separately on demand and are not embedded in the catalog.
- Catalog indexing and broad searches should move to a worker if they cause visible main-thread stalls.

### ADR: Virtualized Song Lists

- React must not mount one element per song.
- Song lists render only visible rows plus a small overscan region.
- Selection is tracked by stable ID, not only by an array index, so catalog and filter updates can restore it.
- Rapid navigation may collapse obsolete metadata or image requests.
- A list virtualization dependency may be added if the custom implementation becomes a maintenance burden.

## Gameplay Runtime

The imperative gameplay runtime owns:

- Chart data and note traversal.
- Keyboard event capture and timestamp conversion.
- Judgment, combo, health, and score state.
- Replay event recording.
- Audio scheduling and song-clock calculation.
- WebGL resources, rendering, and resize handling.
- Gameplay lifecycle and cleanup.

The initial runtime should stay on the main thread. Keyboard events are delivered there, and introducing worker synchronization before profiling would add complexity without guaranteeing lower latency. Expensive preparation can happen in workers before gameplay starts.

## Input and Timing Invariants

- Use `KeyboardEvent.code` for physical lane bindings.
- Ignore repeated `keydown` events for hit generation.
- Record input when the browser event is received; do not wait for the next animation frame.
- Convert event timestamps into the gameplay audio clock domain before judgment.
- Never use `Date.now()` as the gameplay clock.
- A frame stall may delay visuals but must not move a hit window or change the computed song position.
- Audio, visual, and input calibration values must be explicit and persisted.
- Bluetooth audio and low-refresh-rate displays can add substantial physical latency that software cannot remove.

## Suggested Module Boundaries

```text
webclient/
├── src/
│   ├── app/           # React shell, screens, and application lifecycle
│   ├── catalog/       # IndexedDB catalog, synchronization, search
│   ├── select/        # Selection state and virtualized song list
│   ├── gameplay/      # Imperative timing, input, scoring, and session runtime
│   │   └── renderer/  # WebGL2 rendering
│   ├── replay/        # Replay representation and submission
│   └── workers/       # Catalog and asset preparation workers
├── public/
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

These are ownership boundaries rather than a requirement to create every directory immediately. Start with the smallest structure needed for the current feature.

## Performance Policy

- Optimize measured bottlenecks rather than adding concurrency or caching speculatively.
- Keep the main thread free of large synchronous catalog operations while gameplay is active.
- Avoid allocating transient objects for every visible note on every frame.
- Avoid React renders caused by high-frequency gameplay timing state.
- Measure input event arrival, judgment processing, render duration, frame pacing, audio scheduling, and asset loading separately.
- A sub-millisecond JavaScript handler duration is not equivalent to sub-millisecond end-to-end input latency; keyboard polling, browser scheduling, display refresh, audio buffering, and hardware remain part of the path.
- Prefer stable frame pacing and stable offsets over misleading minimum-latency measurements.

## Error Handling

- A stale or unavailable server must not prevent use of an already cached catalog.
- Gameplay asset failures should return the player to song select with an actionable error.
- Unsupported WebGL2 or Web Audio environments should fail at startup with a clear compatibility message.
- Catalog and asset schemas must be versioned so incompatible cached data can be identified and rebuilt safely.

## Security and Trust

- The server is authoritative for account state, catalog publication, and accepted score records.
- The client is necessarily untrusted. Submitted scores should include a replay and sufficient metadata for validation, while acknowledging that a browser client cannot provide strong anti-cheat guarantees.
- Catalog text and remote metadata must be rendered as text, not injected as HTML.
- Asset authorization should use short-lived credentials or the existing authenticated web session rather than credentials embedded in URLs or source code.

## Initial Milestones

1. Create the Vite, React, and strict TypeScript application shell.
2. Load a mock catalog from IndexedDB and render a keyboard-navigable virtualized song list.
3. Download one chart and audio file over HTTP and start it with a scheduled Web Audio clock.
4. Implement a minimal keyboard VSRG runtime with local judgment and WebGL2 rendering.
5. Add calibration, replay recording, results, and score submission.
6. Profile frame pacing and input-to-judgment timing before adding further abstractions.

## Future Work and Open Questions

- Decide the catalog snapshot and incremental-update wire formats.
- Decide whether chart conversion happens on the server or in a browser worker.
- Define the replay format and the degree of server-side replay validation.
- Measure preview bitrate and duration against storage use and perceived quality.
- Measure whether encoded full-song playback can provide sufficiently reliable timing with lower memory use than fully decoded `AudioBuffer` playback.
- Evaluate service-worker asset caching and offline play only after the basic online flow is stable.
- Add WebGPU, `OffscreenCanvas`, `SharedArrayBuffer`, or WASM only when profiling identifies a problem they directly solve.
