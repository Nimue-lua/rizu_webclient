import type { Chartview } from "../library/views";

export interface ChartLinkIdentity {
  chart_md5: string;
  chart_index: number;
}

export function parseChartLink(hash: string): ChartLinkIdentity | null {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const chart_md5 = parameters.get("chart");
  const chart_index = Number(parameters.get("index"));
  if (!chart_md5 || !/^[a-f\d]{32}$/i.test(chart_md5) || !Number.isInteger(chart_index) || chart_index < 1) {
    return null;
  }
  return { chart_md5: chart_md5.toLowerCase(), chart_index };
}

export function chartLinkHash(chart: Pick<Chartview, "chart_md5" | "chart_index">): string {
  return `#chart=${encodeURIComponent(chart.chart_md5.toLowerCase())}&index=${chart.chart_index}`;
}
