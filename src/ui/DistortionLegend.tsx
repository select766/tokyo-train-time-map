import { BAND_COLORS, SPEED_BANDS, type ColorScheme } from '../render/distortionPaint.ts';

/**
 * 背景色の凡例。
 * 色だけに意味を持たせないよう、各段に数値の見出しを必ず添える。
 */
export function DistortionLegend({ scheme }: { scheme: ColorScheme }) {
  const colors = BAND_COLORS[scheme];
  return (
    <div class="legend" role="img" aria-label="背景色は中心駅からの実効速度を表します">
      <span class="legend__title">実効速度 km/h</span>
      <span class="legend__scale">
        <span class="legend__end">遅い</span>
        {SPEED_BANDS.map((band, i) => (
          <span class="legend__band" key={band.label}>
            <span class="legend__swatch" style={{ background: colors[i] }} />
            <span class="legend__tick">{band.label}</span>
          </span>
        ))}
        <span class="legend__end">速い</span>
      </span>
      <span class="legend__note">直線距離 ÷ 所要時間</span>
    </div>
  );
}
