import type { Network } from '../data/network.ts';

/** 中心駅を原点とした駅の配置 */
export interface Placement {
  stationId: number;
  /** 中心駅からの所要時間［分］。到達不能なら Infinity */
  minutes: number;
  /** 中心駅から見た方位［rad］。画面座標系（y は南向き） */
  angle: number;
  x: number;
  y: number;
  reachable: boolean;
}

/**
 * 極座標配置。角度は実際の地理方位、半径は所要時間。
 *
 * 旧実装は経度差と緯度差をそのまま atan2 に渡していたため、東京の緯度では
 * 経度1度が緯度1度より約19%短い分だけ方位が歪んでいた。cos(緯度) を掛けて補正する。
 */
export function layoutPolar(
  network: Network,
  centerStationId: number,
  minutes: Float64Array,
  pxPerMinute: number,
): Placement[] {
  const center = network.station(centerStationId);
  const lonScale = Math.cos((center.lat * Math.PI) / 180);

  return network.stations.map((station) => {
    const m = minutes[station.id] ?? Infinity;
    const reachable = Number.isFinite(m);
    if (station.id === centerStationId) {
      return { stationId: station.id, minutes: 0, angle: 0, x: 0, y: 0, reachable: true };
    }
    const dx = (station.lon - center.lon) * lonScale;
    const dy = station.lat - center.lat;
    // 画面の y 軸は南向きなので緯度差の符号を反転する
    const angle = Math.atan2(-dy, dx);
    const r = reachable ? m * pxPerMinute : 0;
    return {
      stationId: station.id,
      minutes: m,
      angle,
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
      reachable,
    };
  });
}

/** 「30分でどこまで行けるか」を数字で示すための集計 */
export interface ReachStats {
  total: number;
  reachable: number;
  within: { minutes: number; count: number }[];
  median: number;
  farthest: { stationId: number; minutes: number } | null;
}

export function reachStats(minutes: Float64Array, thresholds = [15, 30, 45, 60]): ReachStats {
  const finite: number[] = [];
  let farthest: { stationId: number; minutes: number } | null = null;
  for (let id = 0; id < minutes.length; id++) {
    const m = minutes[id]!;
    if (!Number.isFinite(m)) continue;
    finite.push(m);
    if (!farthest || m > farthest.minutes) farthest = { stationId: id, minutes: m };
  }
  finite.sort((a, b) => a - b);
  const median =
    finite.length === 0
      ? NaN
      : finite.length % 2 === 1
        ? finite[(finite.length - 1) / 2]!
        : (finite[finite.length / 2 - 1]! + finite[finite.length / 2]!) / 2;

  return {
    total: minutes.length,
    reachable: finite.length,
    within: thresholds.map((t) => ({
      minutes: t,
      count: finite.filter((m) => m <= t).length,
    })),
    median,
    farthest,
  };
}
