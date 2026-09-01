import assert from "node:assert/strict";
import test from "node:test";
import { chartLinkHash, parseChartLink } from "../src/app/ChartLink";

test("serializes and parses chart links", () => {
  const hash = chartLinkHash({
    chart_md5: "ABCDEF0123456789ABCDEF0123456789",
    chart_index: 2,
  });

  assert.equal(hash, "#chart=abcdef0123456789abcdef0123456789&index=2");
  assert.deepEqual(parseChartLink(hash), {
    chart_md5: "abcdef0123456789abcdef0123456789",
    chart_index: 2,
  });
});

test("rejects invalid chart links", () => {
  assert.equal(parseChartLink(""), null);
  assert.equal(parseChartLink("#chart=not-an-md5&index=1"), null);
  assert.equal(parseChartLink("#chart=abcdef0123456789abcdef0123456789&index=0"), null);
  assert.equal(parseChartLink("#chart=abcdef0123456789abcdef0123456789&index=1.5"), null);
});
