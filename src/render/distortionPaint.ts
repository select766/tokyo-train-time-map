import type { DistortionField } from '../layout/distortion.ts';

/**
 * 実効速度の場を画像化する。
 *
 * 発散配色（遅い＝赤／標準＝無彩／速い＝青）。中央の帯は全体の中央値
 * 22km/h 前後をまたぐようにとってあり、中心駅を変えても境界は動かない。
 * こうしないと駅ごとの地図を見比べられない。
 *
 * 配色は dataviz スキルの発散ペア（青↔赤・中立グレー）から起こし、
 * scripts/validate_palette.js の全ペア CVD 判定を明暗どちらも通している
 * （明色 ΔE 9.6 / 暗色 ΔE 9.0、いずれも目標値8以上）。
 */
export interface SpeedBand {
  /** この帯の上限［km/h］。最後の帯は Infinity */
  max: number;
  label: string;
}

export const SPEED_BANDS: SpeedBand[] = [
  { max: 13, label: '13未満' },
  { max: 18, label: '13〜18' },
  { max: 24, label: '18〜24' },
  { max: 30, label: '24〜30' },
  { max: Infinity, label: '30以上' },
];

/** 遅い → 速い の順。両モードとも全ペア CVD 判定を通した値 */
export const BAND_COLORS = {
  light: ['#e97871', '#fdbdb7', '#f2f1ee', '#b1d2fe', '#60a0f4'],
  dark: ['#a83635', '#6a2c29', '#211e1f', '#1e4371', '#1962b6'],
} as const;

export type ColorScheme = keyof typeof BAND_COLORS;

export function bandIndex(speed: number): number {
  for (let i = 0; i < SPEED_BANDS.length; i++) {
    if (speed < SPEED_BANDS[i]!.max) return i;
  }
  return SPEED_BANDS.length - 1;
}

/** 周縁をなだらかに消し始める被覆率 */
const FADE_START = 0.06;
const FADE_FULL = 0.22;

/**
 * 場を PNG のデータ URL にする。SVG の <image> にそのまま入れる。
 * 拡大時は画像が引き伸ばされるが、もともと滑らかな面なので粗さは出ない。
 */
export function paintDistortion(field: DistortionField, scheme: ColorScheme): string {
  const { size, values, coverage } = field;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D コンテキストを取得できません');

  const rgb = BAND_COLORS[scheme].map(hexToRgb);
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const o = i * 4;
    if (!Number.isFinite(v)) {
      data[o + 3] = 0;
      continue;
    }
    const c = rgb[bandIndex(v)]!;
    const cov = coverage[i]!;
    // 端をいきなり切ると四角い縁が見えるので被覆率でなじませる
    const alpha = Math.min(1, Math.max(0, (cov - FADE_START) / (FADE_FULL - FADE_START)));
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = Math.round(alpha * 255);
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
