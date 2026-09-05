const compact_score = new Intl.NumberFormat("en", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

export function formatScore(score: number): string {
  return compact_score.format(Math.round(score));
}
