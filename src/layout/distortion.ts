import type { Network } from '../data/network.ts';

/**
 * 「時間距離が直線距離に対してどれだけ歪んでいるか」を面として求める。
 *
 * 各駅について 直線距離[km] ÷ 所要時間[時] = 実効速度[km/h] が計算できる。
 * 速いほど時間距離が縮み、遅いほど伸びている。値が求まるのは駅の位置だけなので、
 * 駅と駅のあいだはガウス重み付き平均（Nadaraya-Watson）で補間する。
 *
 * 補間はタイムマップと同じ「分」座標系で行う。拡大縮小しても場は変わらないので、
 * 中心駅かおまけ路線が変わったときだけ計算し直せばよい。
 */
export interface DistortionField {
  /** 場が覆う範囲。[-extent, +extent] 分 */
  extent: number;
  /** 一辺のセル数 */
  size: number;
  /** 実効速度[km/h]。サンプルが届かないセルは NaN */
  values: Float32Array;
  /** 0〜1。サンプルの届き具合。周縁をなだらかに消すのに使う */
  coverage: Float32Array;
  /** 実際に使えたサンプル数 */
  sampleCount: number;
}

const GRID = 192;
/** ぼかし半径［セル］。小さいと駅ごとの斑が出て、大きいと差が消える */
const BLUR_RADIUS = 7;
/** これ未満の重みしかないセルは値なしとする */
const COVERAGE_FLOOR = 0.06;

const EARTH_RADIUS_KM = 6371;

/** 2駅間の大円距離［km］ */
export function greatCircleKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function computeDistortionField(
  network: Network,
  centerStationId: number,
  minutes: Float64Array,
  /** 分座標系での駅位置（= 画面座標 ÷ pxPerMinute） */
  positions: readonly { stationId: number; x: number; y: number; reachable: boolean }[],
): DistortionField {
  const center = network.station(centerStationId);
  const samples: { x: number; y: number; value: number }[] = [];
  let extent = 1;

  for (const p of positions) {
    if (!p.reachable || p.stationId === centerStationId) continue;
    if (!network.isStationActive(p.stationId)) continue;
    const t = minutes[p.stationId]!;
    if (!Number.isFinite(t) || t <= 0) continue;
    const km = greatCircleKm(center, network.station(p.stationId));
    samples.push({ x: p.x, y: p.y, value: km / (t / 60) });
    extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  }

  // 端の駅が縁で切れないよう少し広げる
  extent *= 1.12;
  const size = GRID;
  const sum = new Float32Array(size * size);
  const weight = new Float32Array(size * size);
  const toCell = (v: number) => ((v + extent) / (2 * extent)) * (size - 1);

  for (const s of samples) {
    // 双一次スプラット。最近傍だと格子に張り付いた模様が出る
    const fx = toCell(s.x);
    const fy = toCell(s.y);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    for (const [dx, dy, w] of [
      [0, 0, (1 - tx) * (1 - ty)],
      [1, 0, tx * (1 - ty)],
      [0, 1, (1 - tx) * ty],
      [1, 1, tx * ty],
    ] as const) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= size || y >= size || w <= 0) continue;
      const i = y * size + x;
      sum[i]! += s.value * w;
      weight[i]! += w;
    }
  }

  // 箱ぼかしを3回かけるとガウスぼかしに十分近づく
  for (let i = 0; i < 3; i++) {
    boxBlur(sum, size, BLUR_RADIUS);
    boxBlur(weight, size, BLUR_RADIUS);
  }

  // 重みは絶対値だと駅密度に依存するので最大値で正規化する
  let maxWeight = 0;
  for (const w of weight) if (w > maxWeight) maxWeight = w;

  const values = new Float32Array(size * size);
  const coverage = new Float32Array(size * size);
  for (let i = 0; i < values.length; i++) {
    const c = maxWeight > 0 ? weight[i]! / maxWeight : 0;
    coverage[i] = c;
    values[i] = c >= COVERAGE_FLOOR ? sum[i]! / weight[i]! : NaN;
  }

  return { extent, size, values, coverage, sampleCount: samples.length };
}

/** 分離型の箱ぼかし。横→縦の順に走査する */
function boxBlur(data: Float32Array, size: number, radius: number): void {
  const tmp = new Float32Array(data.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < size; y++) {
    const row = y * size;
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += data[row + clamp(x, size)]!;
    for (let x = 0; x < size; x++) {
      tmp[row + x] = acc / span;
      acc -= data[row + clamp(x - radius, size)]!;
      acc += data[row + clamp(x + radius + 1, size)]!;
    }
  }

  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[clamp(y, size) * size + x]!;
    for (let y = 0; y < size; y++) {
      data[y * size + x] = acc / span;
      acc -= tmp[clamp(y - radius, size) * size + x]!;
      acc += tmp[clamp(y + radius + 1, size) * size + x]!;
    }
  }
}

function clamp(v: number, size: number): number {
  return v < 0 ? 0 : v >= size ? size - 1 : v;
}
