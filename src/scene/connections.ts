/** Maps a child code metric to a physical connector radius. */
export function connectionRadius(metric: number, maximumMetric: number): number {
  const safeMetric = Math.max(0, metric);
  const safeMaximum = Math.max(1, maximumMetric);
  const normalized = Math.log1p(safeMetric) / Math.log1p(safeMaximum);
  return 0.035 + normalized * 0.11;
}
