import type { DanCourseDefinition } from "./DanCourse";

const chart = (chart_md5: string) => ({ chart_md5, chart_index: 1 });

export const dan_courses: readonly DanCourseDefinition[] = [
  { id: "osu-normal-1st", name: "Normal 1st", mode: "osu", goal_accuracy: .94, charts: [
    chart("84091020f3e6c4c39d4b46ece69ec26c"), chart("95b407773d404c67f2ae32df8226bd2f"),
    chart("33f7a9860d5602855a9ca4b5d37541eb"),
  ] },
];
