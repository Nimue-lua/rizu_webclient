import assert from "node:assert/strict";
import test from "node:test";
import { GameplayPerformanceGraph } from "../src/gameplay/GameplayPerformance";

test("draws gameplay performance labels without graph lines", () => {
  const calls = { strokes: 0, texts: [] as string[] };
  const context = {
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { calls.strokes += 1; },
    fillText(text: string) { calls.texts.push(text); },
    font: "", textBaseline: "top", fillStyle: "", strokeStyle: "", lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    clientWidth: 800, clientHeight: 600, width: 0, height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const graph = new GameplayPerformanceGraph(canvas, () => 2);

  graph.push({ timestamp: 100, update_ms: 1, draw_ms: 2, draw_calls: 12 });
  graph.push({ timestamp: 400, update_ms: 2, draw_ms: 3, draw_calls: 14 });
  graph.push({ timestamp: 600, update_ms: 1, draw_ms: 2, draw_calls: 16 });

  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 1200);
  assert.equal(calls.strokes, 0);
  assert.ok(calls.texts.some((text) => text.includes("frame 0.00ms")));
  assert.ok(calls.texts.some((text) => text === "update 1.50ms"));
  assert.ok(calls.texts.some((text) => text === "draw 2.50ms"));
  assert.ok(calls.texts.some((text) => text === "drawcalls 16"));
  assert.ok(calls.texts.some((text) => text.startsWith("1% low ")));
  assert.ok(calls.texts.every((text) => !text.includes("0.1%") && !text.includes("0.01%")));
});
