// Axis helpers and colors shared by the overview charts.

// Line colors, the dataviz reference categorical palette in its fixed order.
// The validator passed all 8 adjacent pairs on the white card (worst CVD
// ΔE 9.1). Aqua, yellow and magenta are below 3:1 on white, so the legend
// and the Table view carry identity too. Past 8 series, a chart folds the
// rest into "Other" or repeats the colors as dashed lines.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

// Round the axis maximum up to 1, 2 or 5 × 10^n and return 4 even steps.
export function niceTicks(max) {
  if (max <= 0) return [0, 1000, 2000, 3000, 4000]
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= raw)
  return [0, 1, 2, 3, 4].map((i) => i * step)
}

export function compact(n) {
  return n >= 1000 ? `₪${Math.round(n / 1000)}K` : `₪${n}`
}
