import type { Network } from '../data/network.ts';
import { greatCircleKm } from './distortion.ts';
import { reachStats } from './polar.ts';

export interface StationRanking {
  stationId: number;
  /** 30分以内に到達できる駅数 */
  within30: number;
  /** ゆがみ指数。中心から見た実効速度（直線距離÷所要時間）の、方向によるばらつき */
  distortionIndex: number;
  /** ゆがみ指数の計算に使えたサンプル数（到達可能な他駅の数） */
  sampleCount: number;
}

/**
 * ゆがみ指数 = ln(実効速度) の標準偏差。
 *
 * 各駅 s について実効速度 v(s) = 直線距離 ÷ 所要時間 を求め、
 * その対数を中心駅自身の幾何平均からの偏差として集計する。
 * 対数を使うのは「近いのに時間がかかる駅」と「遠いのに時間が短い駅」を
 * 対称に扱うため。幾何平均を基準にすることで偏差の総和が0になり、
 * 恣意的な基準値を持ち込まずに済む。
 */
export function computeDistortionIndex(
  network: Network,
  centerStationId: number,
  minutes: Float64Array,
): { index: number; sampleCount: number } {
  const center = network.station(centerStationId);
  const logSpeeds: number[] = [];
  for (const station of network.stations) {
    if (station.id === centerStationId) continue;
    if (!network.isStationActive(station.id)) continue;
    const t = minutes[station.id]!;
    if (!Number.isFinite(t) || t <= 0) continue;
    const km = greatCircleKm(center, station);
    if (km <= 0) continue;
    logSpeeds.push(Math.log(km / (t / 60)));
  }
  if (logSpeeds.length === 0) return { index: 0, sampleCount: 0 };
  const mean = logSpeeds.reduce((a, b) => a + b, 0) / logSpeeds.length;
  const variance = logSpeeds.reduce((a, b) => a + (b - mean) ** 2, 0) / logSpeeds.length;
  return { index: Math.sqrt(variance), sampleCount: logSpeeds.length };
}

/** 表示対象の全駅を中心にしたときの到達駅数・ゆがみ指数を求める */
export function rankStations(network: Network): StationRanking[] {
  return network.activeStations().map((station) => {
    const minutes = network.travelMinutesFrom(station.id);
    const within30 = reachStats(minutes, [30]).within[0]?.count ?? 0;
    const { index, sampleCount } = computeDistortionIndex(network, station.id, minutes);
    return { stationId: station.id, within30, distortionIndex: index, sampleCount };
  });
}
