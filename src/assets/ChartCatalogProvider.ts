import type { GameplayAssetReference } from "./GameplayAssetProvider";

export interface ChartCatalogProvider {
  getChart(chart_id: string, signal: AbortSignal): Promise<GameplayAssetReference>;
}

export class HttpChartCatalogProvider implements ChartCatalogProvider {
  async getChart(chart_id: string, signal: AbortSignal): Promise<GameplayAssetReference> {
    const response = await fetch(`/api/charts/${encodeURIComponent(chart_id)}`, { signal });

    if (!response.ok) {
      throw new Error(`Failed to load the selected chart: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<GameplayAssetReference>;
  }
}
