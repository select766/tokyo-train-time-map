import { describe, expect, it } from 'vitest';
import { Network } from '../../src/data/network.ts';
import type { NetworkData, Station } from '../../src/data/schema.ts';
import { layoutPolar } from '../../src/layout/polar.ts';
import { layoutLabels } from '../../src/layout/labels.ts';

/** 東京駅を中心に、東西南北へ1駅ずつ置いた最小のネットワーク */
function fixture(): Network {
  const stations: Station[] = [
    { id: 0, name: '中心', lat: 35.68, lon: 139.77, priority: 2, nodeIds: [0], lineIds: [0] },
    { id: 1, name: '東', lat: 35.68, lon: 139.87, priority: 0, nodeIds: [1], lineIds: [0] },
    { id: 2, name: '北', lat: 35.78, lon: 139.77, priority: 0, nodeIds: [2], lineIds: [0] },
    { id: 3, name: '西', lat: 35.68, lon: 139.67, priority: 0, nodeIds: [3], lineIds: [0] },
    { id: 4, name: '南', lat: 35.58, lon: 139.77, priority: 0, nodeIds: [4], lineIds: [0] },
  ];
  const data: NetworkData = {
    meta: {
      generatedAt: '',
      timetableBasis: '',
      transferMinutes: 5,
      sources: [],
      notes: [],
    },
    lines: [{ id: 0, name: 'テスト線', company: 'テスト', color: '#000000' }],
    stations,
    nodes: stations.map((s) => ({ id: s.id, stationId: s.id, lineId: 0 })),
    edges: [
      { a: 0, b: 1, minutes: 10, lineId: 0 },
      { a: 0, b: 2, minutes: 20, lineId: 0 },
      { a: 0, b: 3, minutes: 30, lineId: 0 },
      { a: 0, b: 4, minutes: 40, lineId: 0 },
    ],
  };
  return new Network(data);
}

describe('layoutPolar', () => {
  const network = fixture();
  const minutes = network.travelMinutesFrom(0);
  const placements = layoutPolar(network, 0, minutes, 10);
  const at = (id: number) => placements.find((p) => p.stationId === id)!;

  it('中心駅は原点に置かれる', () => {
    expect(at(0).x).toBe(0);
    expect(at(0).y).toBe(0);
    expect(at(0).minutes).toBe(0);
  });

  it('中心からの距離が所要時間 × 倍率になる', () => {
    for (const id of [1, 2, 3, 4]) {
      const p = at(id);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(p.minutes * 10, 6);
    }
  });

  it('方位が地理どおりに保たれる（画面の y 軸は南向き）', () => {
    expect(at(1).x).toBeGreaterThan(0); // 東は右
    expect(at(1).y).toBeCloseTo(0, 6);
    expect(at(2).y).toBeLessThan(0); // 北は上
    expect(at(2).x).toBeCloseTo(0, 6);
    expect(at(3).x).toBeLessThan(0); // 西は左
    expect(at(4).y).toBeGreaterThan(0); // 南は下
  });

  it('経度の縮みを補正している', () => {
    // 東へ0.1度、北へ0.1度。緯度35.68度では経度0.1度は約9.0km、緯度0.1度は約11.1km
    // なので、真の方位は北寄りの約50.7度。補正しないと45度ちょうどになってしまう。
    const ne: Station = {
      id: 5,
      name: '北東',
      lat: 35.78,
      lon: 139.87,
      priority: 0,
      nodeIds: [],
      lineIds: [],
    };
    const netWithNe = new Network({
      ...network.data,
      stations: [...network.data.stations, ne],
    });
    const m = Float64Array.from([0, 10, 20, 30, 40, 10]);
    const p = layoutPolar(netWithNe, 0, m, 10).find((q) => q.stationId === 5)!;
    const deg = (-p.angle * 180) / Math.PI;
    expect(deg).toBeGreaterThan(48);
    expect(deg).toBeLessThan(54);
  });

  it('倍率を変えても方位は変わらない', () => {
    const wide = layoutPolar(network, 0, minutes, 40);
    for (const id of [1, 2, 3, 4]) {
      expect(wide.find((p) => p.stationId === id)!.angle).toBeCloseTo(at(id).angle, 10);
    }
  });
});

describe('layoutLabels', () => {
  const network = fixture();
  const placements = layoutPolar(network, 0, network.travelMinutesFrom(0), 10);

  const run = (size: { width: number; height: number }) =>
    layoutLabels({
      placements,
      centerStationId: 0,
      score: (id) => network.labelScore(network.station(id)),
      measure: () => size,
    });

  it('十分に空いていれば全ラベルが駅位置そのままに置かれる', () => {
    const { labels, hidden } = run({ width: 20, height: 12 });
    expect(labels).toHaveLength(5);
    expect(hidden.size).toBe(0);
    for (const l of labels) {
      expect(l.displaced).toBe(false);
      expect(l.x).toBeCloseTo(l.anchorX, 6);
      expect(l.y).toBeCloseTo(l.anchorY, 6);
    }
  });

  it('重なる場合は接線方向にずらし、半径（＝所要時間）を保つ', () => {
    // 駅間隔より大きなラベルを与えて衝突させる
    const { labels } = run({ width: 400, height: 200 });
    const displaced = labels.filter((l) => l.displaced);
    expect(displaced.length).toBeGreaterThan(0);
    for (const l of displaced) {
      const rAnchor = Math.hypot(l.anchorX, l.anchorY);
      const rLabel = Math.hypot(l.x, l.y);
      // 接線方向にずらすので半径は伸びる側にしか動かず、増分もわずかに留まる
      expect(rLabel).toBeGreaterThanOrEqual(rAnchor - 1e-6);
    }
  });

  /** 同じ方位に並ぶ駅列。接線方向がすべて同じなので逃げ場が限られる */
  const collinear = (count: number) =>
    layoutLabels({
      placements: Array.from({ length: count }, (_, i) => ({
        stationId: i,
        minutes: i * 5,
        angle: 0,
        x: i * 30,
        y: 0,
        reachable: true,
      })),
      centerStationId: 0,
      score: (id) => -id,
      measure: () => ({ width: 400, height: 20 }),
    });

  it('ずらしきれない駅は hidden に入り、labels には出てこない', () => {
    const { labels, hidden } = collinear(12);
    // ずらせるのは接線方向に7段まで。12駅は入りきらない
    expect(labels.length).toBeLessThan(12);
    expect(labels.length + hidden.size).toBe(12);
    for (const l of labels) expect(hidden.has(l.stationId)).toBe(false);
  });

  it('中心駅のラベルは必ず確保される', () => {
    const { labels, hidden } = collinear(12);
    expect(hidden.has(0)).toBe(false);
    expect(labels[0]?.stationId).toBe(0);
  });

  it('ラベル同士は重ならない', () => {
    const { labels } = collinear(12);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2;
        const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2;
        expect(overlapX && overlapY, `${a.stationId} と ${b.stationId}`).toBe(false);
      }
    }
  });

  it('優先度の高い駅が先に場所を取る', () => {
    const { labels } = run({ width: 400, height: 200 });
    // 中心（優先度2）は必ず先頭
    expect(labels[0]!.stationId).toBe(0);
  });

  it('到達不能な駅はラベルを持たない', () => {
    const unreachable = layoutPolar(
      network,
      0,
      Float64Array.from([0, 10, Infinity, 30, 40]),
      10,
    );
    const { hidden } = layoutLabels({
      placements: unreachable,
      centerStationId: 0,
      score: () => 0,
      measure: () => ({ width: 10, height: 10 }),
    });
    expect(hidden.has(2)).toBe(true);
  });
});
