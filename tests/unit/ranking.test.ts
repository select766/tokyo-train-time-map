import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/data/network.ts';
import type { NetworkData, Station } from '../../src/data/schema.ts';
import { computeDistortionIndex, rankStations } from '../../src/layout/ranking.ts';

const data = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../public/data/network.json'), 'utf-8'),
) as NetworkData;
const network = new Network(data);

function id(name: string): number {
  const s = network.findByName(name);
  if (!s) throw new Error(`駅が見つかりません: ${name}`);
  return s.id;
}

/** computeDistortionIndex は station/isStationActive/stations しか見ないので、経路計算なしの最小構成で足りる */
function fakeNetwork(stations: Station[]): Network {
  const byId = new Map(stations.map((s) => [s.id, s]));
  return {
    stations,
    station: (sid: number) => {
      const s = byId.get(sid);
      if (!s) throw new Error(`未知の駅 id: ${sid}`);
      return s;
    },
    isStationActive: () => true,
  } as unknown as Network;
}

function station(id: number, name: string, lat: number, lon: number): Station {
  return { id, name, lat, lon, priority: 0, nodeIds: [], lineIds: [] };
}

describe('computeDistortionIndex', () => {
  it('距離と時間が完全に比例していれば指数は厳密に0になる', () => {
    const n = fakeNetwork([
      station(0, '中心', 35.68, 139.77),
      station(1, 'A', 35.7, 139.77),
      station(2, 'B', 35.68, 139.79),
      station(3, 'C', 35.66, 139.77),
    ]);
    // 各駅までの直線距離を求め、同じ速度になるよう所要時間を逆算する
    const speed = 30; // km/h
    const minutes = new Float64Array(4);
    for (const s of n.stations) {
      if (s.id === 0) continue;
      const dLat = (s.lat - 35.68) * (Math.PI / 180);
      const dLon = (s.lon - 139.77) * (Math.PI / 180) * Math.cos((35.68 * Math.PI) / 180);
      const km = 6371 * Math.sqrt(dLat ** 2 + dLon ** 2);
      minutes[s.id] = (km / speed) * 60;
    }
    const { index, sampleCount } = computeDistortionIndex(n, 0, minutes);
    expect(sampleCount).toBe(3);
    expect(index).toBeCloseTo(0, 5);
  });

  it('方向によって実効速度が違えば指数は正になる', () => {
    const n = fakeNetwork([
      station(0, '中心', 35.68, 139.77),
      station(1, '速い方', 35.78, 139.77),
      station(2, '遅い方', 35.7, 139.77),
    ]);
    // 速い方: 直線距離約11.1kmを10分で。遅い方: 直線距離約2.2kmを10分で
    const minutes = Float64Array.from([0, 10, 10]);
    const { index } = computeDistortionIndex(n, 0, minutes);
    expect(index).toBeGreaterThan(0);
  });

  it('到達可能な駅が1つ以下なら0を返す（分散が定義できない）', () => {
    const n = fakeNetwork([station(0, '中心', 35.68, 139.77), station(1, '隣', 35.69, 139.77)]);
    expect(computeDistortionIndex(n, 0, Float64Array.from([0, Infinity])).sampleCount).toBe(0);
    expect(computeDistortionIndex(n, 0, Float64Array.from([0, 5])).index).toBe(0);
  });
});

describe('rankStations（実データ）', () => {
  it('全ての表示対象駅について指数と到達駅数を返す', () => {
    const ranking = rankStations(network);
    expect(ranking).toHaveLength(network.activeStations().length);
    for (const r of ranking) {
      expect(r.within30).toBeGreaterThanOrEqual(0);
      expect(r.distortionIndex).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.distortionIndex)).toBe(true);
    }
  });

  it('東京駅は都心なので30分以内到達数が多い側に入る', () => {
    const ranking = rankStations(network);
    const tokyo = ranking.find((r) => r.stationId === id('東京'))!;
    const sorted = [...ranking].sort((a, b) => b.within30 - a.within30);
    const rank = sorted.findIndex((r) => r.stationId === tokyo.stationId);
    // 上位3割以内に入る想定
    expect(rank).toBeLessThan(ranking.length * 0.3);
  });
});
