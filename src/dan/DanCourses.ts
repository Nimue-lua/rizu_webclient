import type { DanCourseDefinition } from "./DanCourse";

const osu_chart = (chart_md5: string) => ({ chart_md5, chart_index: 1 });

export const dan_courses: readonly DanCourseDefinition[] = [
  { id: "osu-basic-1st", name: "Basic 1st", mode: "osu", goal_accuracy: .94, charts: [
    osu_chart("84091020f3e6c4c39d4b46ece69ec26c"), 
    osu_chart("95b407773d404c67f2ae32df8226bd2f"),
    osu_chart("33f7a9860d5602855a9ca4b5d37541eb"),
  ] },
  { id: "osu-basic-2nd", name: "Basic 2nd", mode: "osu":, goal_accuracy: .94, charts: [
    osu_chart("7724b97d4a96885bd51e15e53251d162")
    osu_chart("db1d5b5e4ea69a0066ce921142b545ce"),
    osu_chart("337b84ece92abbd1df04358cc15f4fbe")
  ] },
  { id: "osu-basic-3rd", name: "Basic 3rd", mode: "osu":, goal_accuracy: .94, charts: [
    osu_chart("5f793e489b8cd29bac90957e7b66c646")
    osu_chart("098e4842606d95e11c56203f09c99e5d")
    osu_chart("eb6538c21fa5595b6f3e506c85cb395f")
  ]}
  /*{ id: "osu-normal-1st", name: "normal 1st", mode: "osu":, goal_accuracy: .94, charts: [
    osu_chart("8f56ede9fe1442593481b45b514405a6"),
    osu_chart(""),
    osu_chart("a42c93548497eb2549f6a743283537aa"),
  ]}*/

	// osu-normal-2nd second chart 4bf95536b6ec5019300d33cbbd86dbd5
];
