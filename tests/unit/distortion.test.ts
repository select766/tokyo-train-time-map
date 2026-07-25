import { describe, expect, it } from 'vitest';
import { Network } from '../../src/data/network.ts';
import type { NetworkData, Station } from '../../src/data/schema.ts';
import { computeDistortionField, greatCircleKm } from '../../src/layout/distortion.ts';
import { bandIndex, SPEED_BANDS, BAND_COLORS } from '../../src/render/distortionPaint.ts';
import { layoutPolar } from '../../src/layout/polar.ts';

describe('greatCircleKm', () => {
  it('緯度1度はおよそ111km', () => {
    const d = greatCircleKm({ lat: 35, lon: 139 }, { lat: 36, lon: 139 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('東京の緯度では経度1度のほうが短い', () => {
    const lat = greatCircleKm({ lat: 35.68, lon: 139.77 }, { lat: 36.68, lon: 139.77 });
    const lon = greatCircleKm({ lat: 35.68, lon: 139.77 }, { lat: 35.68, lon: 140.77 });
    expect(lon).toBeLessThan(lat);
    expect(lon / lat).toBeCloseTo(Math.cos((35.68 * Math.PI) / 180), 2);
  });

  it('同じ地点なら0', () => {
    expect(greatCircleKm({ lat: 35.68, lon: 139.77 }, { lat: 35.68, lon: 139.77 })).toBe(0);
  });
});

describe('bandIndex', () => {
  it('境界値は上の帯に入る', () => {
    expect(bandIndex(12.9)).toBe(0);
    expect(bandIndex(13)).toBe(1);
    expect(bandIndex(17.9)).toBe(1);
    expect(bandIndex(18)).toBe(2);
    expect(bandIndex(24)).toBe(3);
    expect(bandIndex(30)).toBe(4);
    expect(bandIndex(999)).toBe(4);
  });

  it('帯と色の数が一致する', () => {
    expect(BAND_COLORS.light).toHaveLength(SPEED_BANDS.length);
    expect(BAND_COLORS.dark).toHaveLength(SPEED_BANDS.length);
  });
});

/**
 * 中心から東へ「速い」駅、西へ「遅い」駅を置いた人工ネットワーク。
 * 東は10分で約9km(≒54km/h)、西は10分で約1.8km(≒11km/h)進む。
 */
function fixture(): Network {
  const stations: Station[] = [
    { id: 0, name: '中心', lat: 35.68, lon: 139.77, priority: 0, nodeIds: [0], lineIds: [0] },
    { id: 1, name: '東', lat: 35.68, lon: 139.87, priority: 0, nodeIds: [1], lineIds: [0] },
    { id: 2, name: '西', lat: 35.68, lon: 139.75, priority: 0, nodeIds: [2], lineIds: [0] },
  ];
  const data: NetworkData = {
    meta: { generatedAt: '', timetableBasis: '', transferMinutes: 5, sources: [], notes: [] },
    lines: [{ id: 0, name: 'テスト線', company: 'テスト', color: '#000000', group: null }],
    optionalGroups: [],
    stations,
    nodes: stations.map((s) => ({ id: s.id, stationId: s.id, lineId: 0 })),
    edges: [
      { a: 0, b: 1, minutes: 10, lineId: 0 },
      { a: 0, b: 2, minutes: 10, lineId: 0 },
    ],
  };
  return new Network(data);
}

describe('computeDistortionField', () => {
  const network = fixture();
  const minutes = network.travelMinutesFrom(0);
  // 倍率1で組めば layout 座標がそのまま分座標になる
  const positions = layoutPolar(network, 0, minutes, 1);
  const field = computeDistortionField(network, 0, minutes, positions);

  /** 分座標 (x, y) のセルの値 */
  const at = (x: number, y: number) => {
    const c = (v: number) => {
      const i = Math.round(((v + field.extent) / (2 * field.extent)) * (field.size - 1));
      return Math.min(field.size - 1, Math.max(0, i));
    };
    return field.values[c(y) * field.size + c(x)]!;
  };

  it('中心駅は速度が定義できないのでサンプルに含めない', () => {
    expect(field.sampleCount).toBe(2);
  });

  it('速い側と遅い側で値が分かれる', () => {
    const east = at(9, 0);
    const west = at(-9, 0);
    expect(east).toBeGreaterThan(40);
    expect(west).toBeLessThan(20);
    expect(east).toBeGreaterThan(west);
  });

  it('駅の位置ではおおむねその駅の実効速度になる', () => {
    // 東は 0.1度 ≒ 9.04km を10分 → 約54km/h
    const expected = (greatCircleKm({ lat: 35.68, lon: 139.77 }, { lat: 35.68, lon: 139.87 }) / 10) * 60;
    expect(at(10, 0)).toBeGreaterThan(expected * 0.8);
    expect(at(10, 0)).toBeLessThan(expected * 1.2);
  });

  it('サンプルから遠いセルは値なしになる', () => {
    expect(Number.isNaN(at(field.extent, field.extent))).toBe(true);
  });

  it('値があるセルは必ず正の速度', () => {
    for (const v of field.values) {
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(500);
    }
  });

  it('被覆率は 0〜1 に収まる', () => {
    for (const c of field.coverage) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('全駅が同じ実効速度なら場は一様になる', () => {
    // 東西とも同じ距離・同じ時間にすると、値の散らばりが消えるはず
    const n = fixture();
    const even = Float64Array.from([0, 10, 10]);
    const evenStations = [...n.stations];
    evenStations[2] = { ...evenStations[2]!, lon: 139.67 }; // 中心から東と同じ距離
    const n2 = new Network({ ...n.data, stations: evenStations });
    const f = computeDistortionField(n2, 0, even, layoutPolar(n2, 0, even, 1));
    const vals = [...f.values].filter((v) => !Number.isNaN(v));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    expect(max - min).toBeLessThan(0.5);
  });

  it('到達できない駅はサンプルに入らない', () => {
    const n = fixture();
    const m = Float64Array.from([0, 10, Infinity]);
    const f = computeDistortionField(n, 0, m, layoutPolar(n, 0, m, 1));
    expect(f.sampleCount).toBe(1);
  });
});
