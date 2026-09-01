import type { Chartview } from "../library/views";

export interface ChartLinkIdentity {
  chart_md5: string;
  chart_index: number;
}

function validChartIdentity(chart_md5: string | null, chart_index: number): ChartLinkIdentity | null {
  if (!chart_md5 || !/^[a-f\d]{32}$/i.test(chart_md5) || !Number.isInteger(chart_index) || chart_index < 1) {
    return null;
  }
  return { chart_md5: chart_md5.toLowerCase(), chart_index };
}

export function parseChartLink(pathname: string, hash = ""): ChartLinkIdentity | null {
  const path_match = pathname.match(/^\/chart\/([a-f\d]{32})\/(\d+)\/?$/i);
  if (path_match) return validChartIdentity(path_match[1], Number(path_match[2]));

  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return validChartIdentity(parameters.get("chart"), Number(parameters.get("index")));
}

export function chartLinkPath(chart: Pick<Chartview, "chart_md5" | "chart_index">): string {
  return `/chart/${encodeURIComponent(chart.chart_md5.toLowerCase())}/${chart.chart_index}`;
}
