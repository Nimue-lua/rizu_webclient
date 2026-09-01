import assert from "node:assert/strict";
import test from "node:test";
import { chartLinkPath, parseChartLink } from "../src/app/ChartLink";

test("serializes and parses chart links", () => {
  const path = chartLinkPath({
    chart_md5: "ABCDEF0123456789ABCDEF0123456789",
    chart_index: 2,
  });

  assert.equal(path, "/chart/abcdef0123456789abcdef0123456789/2");
  assert.deepEqual(parseChartLink(path), {
    chart_md5: "abcdef0123456789abcdef0123456789",
    chart_index: 2,
  });
});

test("retains compatibility with fragment chart links", () => {
  assert.deepEqual(parseChartLink("/", "#chart=abcdef0123456789abcdef0123456789&index=2"), {
    chart_md5: "abcdef0123456789abcdef0123456789",
    chart_index: 2,
  });
});

test("rejects invalid chart links", () => {
  assert.equal(parseChartLink("/"), null);
  assert.equal(parseChartLink("/chart/not-an-md5/1"), null);
  assert.equal(parseChartLink("/", "#chart=abcdef0123456789abcdef0123456789&index=0"), null);
  assert.equal(parseChartLink("/chart/abcdef0123456789abcdef0123456789/1.5"), null);
});
