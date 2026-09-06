import { inputLayout, loadInputBindings } from "../gameplay/InputBindings";
import type { PlayRequest } from "../gameplay/GameplayController";
import type { ChartSelectorSnapshot } from "../select/ChartSelector";
import type { DanCourseDefinition, ResolvedDanCourse } from "./DanCourse";

export function resolveDanCourse(definition: DanCourseDefinition,
  library: ChartSelectorSnapshot): ResolvedDanCourse | null {
  if (definition.charts.length < 2) return null;
  const stages = definition.charts.map((identity) => {
    for (const song of library.songs) {
      const chart = song.charts.find((candidate) => candidate.chart_index === identity.chart_index &&
        candidate.chart_md5.toLowerCase() === identity.chart_md5.toLowerCase());
      if (chart) return { chart, input_bindings: loadInputBindings(inputLayout(chart)),
        song: { title: song.title, artist: song.artist } };
    }
    return null;
  });
  if (stages.some((stage) => stage === null)) return null;
  return { ...definition, stages: stages as PlayRequest[] };
}
