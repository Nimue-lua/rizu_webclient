import assert from "node:assert/strict";
import test from "node:test";
import type { OsuPointerInput } from "../src/gameplay/GameplaySession";
import { bindOsuPointerAim, osuPointerMovementEvent } from "../src/gameplay/osu/OsuPointerAimBinding";

class FakeEventTarget {
  readonly listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener): void { this.listeners.get(type)?.delete(listener); }
  dispatch(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as Event);
  }
  count(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

test("selects raw updates only when enabled and supported", () => {
  assert.equal(osuPointerMovementEvent(true, true), "pointerrawupdate");
  assert.equal(osuPointerMovementEvent(false, true), "pointermove");
  assert.equal(osuPointerMovementEvent(true, false), "pointermove");
});

test("binds one aim stream for mouse and pen with cached bounds", () => {
  const target = new FakeEventTarget();
  const aims: unknown[][] = [];
  const input = {
    aimPointer: (...args: unknown[]) => aims.push(args),
  } as unknown as OsuPointerInput;
  let bounds = { left: 10, top: 20, width: 640, height: 480 };
  let refresh_bounds = () => undefined;
  let stopped = false;
  const unbind = bindOsuPointerAim(input, "pointerrawupdate", {
    event_target: target,
    get_bounds: () => bounds,
    observe_resize: (callback) => {
      refresh_bounds = callback;
      return () => { stopped = true; };
    },
  });

  assert.equal(target.count("pointerrawupdate"), 1);
  assert.equal(target.count("pointermove"), 0);
  target.dispatch("pointerrawupdate", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 200, timeStamp: 30 });
  target.dispatch("pointerrawupdate", { pointerType: "pen", pointerId: 2, clientX: 300, clientY: 400, timeStamp: 40 });
  target.dispatch("pointerrawupdate", { pointerType: "touch", pointerId: 3, clientX: 500, clientY: 600, timeStamp: 50 });
  assert.deepEqual(aims, [
    [1, 100, 200, { left: 10, top: 20, width: 640, height: 480 }, 30],
    [2, 300, 400, { left: 10, top: 20, width: 640, height: 480 }, 40],
  ]);

  bounds = { left: 0, top: 0, width: 1280, height: 960 };
  refresh_bounds();
  target.dispatch("pointerrawupdate", { pointerType: "pen", pointerId: 2, clientX: 600, clientY: 800, timeStamp: 60 });
  assert.deepEqual(aims[2], [2, 600, 800, bounds, 60]);

  unbind();
  assert.equal(target.count("pointerrawupdate"), 0);
  assert.equal(stopped, true);
});
