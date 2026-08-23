import assert from "node:assert/strict";
import test from "node:test";
import { SpringValue } from "../src/gameplay/SpringValue";

test("smoothly converges on a target without overshooting", () => {
  const spring = new SpringValue(0);
  let previous = spring.value;
  for (let frame = 0; frame < 120; frame += 1) {
    const value = spring.update(100, 1 / 60);
    assert.ok(value >= previous && value <= 100);
    previous = value;
  }
  assert.ok(Math.abs(spring.value - 100) < 0.0001);
});

test("produces similar motion at different frame rates", () => {
  const sixty_fps = new SpringValue(0);
  const thirty_fps = new SpringValue(0);
  for (let frame = 0; frame < 60; frame += 1) sixty_fps.update(100, 1 / 60);
  for (let frame = 0; frame < 30; frame += 1) thirty_fps.update(100, 1 / 30);
  assert.ok(Math.abs(sixty_fps.value - thirty_fps.value) < 1e-10);
});

test("can teleport before returning to its target", () => {
  const spring = new SpringValue(0);
  spring.teleport(-10);
  assert.equal(spring.value, -10);
  assert.ok(spring.update(0, 1 / 60) > -10);
});
