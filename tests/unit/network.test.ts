import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/data/network.ts';
import type { NetworkData } from '../../src/data/schema.ts';
import { reachStats } from '../../src/layout/polar.ts';

const data = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../public/data/network.json'), 'utf-8'),
) as NetworkData;
const network = new Network(data);

function id(name: string): number {
  const s = network.findByName(name);
  if (!s) throw new Error(`駅が見つかりません: ${name}`);
  return s.id;
}

function minutes(from: string, to: string): number {
  return network.travelMinutesFrom(id(from))[id(to)]!;
}

describe('生成されたネットワークデータ', () => {
  it('全駅に緯度経度がある', () => {
    for (const s of network.stations) {
      expect(Number.isFinite(s.lat), s.name).toBe(true);
      expect(Number.isFinite(s.lon), s.name).toBe(true);
      // 対象は東京23区周辺なのでこの範囲を外れたら座標の取り違え
      expect(s.lat, s.name).toBeGreaterThan(35.4);
      expect(s.lat, s.name).toBeLessThan(36.0);
      expect(s.lon, s.name).toBeGreaterThan(139.4);
      expect(s.lon, s.name).toBeLessThan(140.1);
    }
  });

  it('駅名が重複しない', () => {
    const names = new Set(network.stations.map((s) => s.name));
    expect(names.size).toBe(network.stations.length);
  });

  it('乗車エッジの所要時間が現実的な範囲に収まる', () => {
    for (const e of data.edges) {
      if (e.lineId === null) continue;
      expect(e.minutes).toBeGreaterThan(0);
      expect(e.minutes).toBeLessThanOrEqual(10);
    }
  });

  it('どの駅からも全駅に到達できる', () => {
    for (const s of network.activeStations()) {
      const m = network.travelMinutesFrom(s.id);
      const unreachable = network.activeStations().filter((t) => !Number.isFinite(m[t.id]!));
      expect(unreachable.map((t) => t.name), `${s.name} から`).toEqual([]);
    }
  });

  it('所要時間は対称である', () => {
    // 全エッジが無向なので、どちらから測っても同じでなければならない
    for (const [a, b] of [
      ['新宿', '東京'],
      ['渋谷', '北千住'],
      ['西高島平', '西船橋'],
    ] as const) {
      expect(minutes(a, b)).toBe(minutes(b, a));
    }
  });

  it('2020年以降に開業した駅が含まれている', () => {
    expect(network.findByName('虎ノ門ヒルズ')).toBeDefined();
    expect(network.findByName('高輪ゲートウェイ')).toBeDefined();
  });

  it('虎ノ門ヒルズが日比谷線の神谷町と霞ヶ関の間に入っている', () => {
    expect(minutes('神谷町', '虎ノ門ヒルズ')).toBe(1);
    expect(minutes('虎ノ門ヒルズ', '霞ヶ関')).toBe(2);
    // 新駅の停車ぶん、直通していた頃より1分伸びる
    expect(minutes('神谷町', '霞ヶ関')).toBe(3);
  });

  it('高輪ゲートウェイが山手線の田町と品川の間に入っている', () => {
    expect(minutes('田町', '高輪ゲートウェイ')).toBe(2);
    expect(minutes('高輪ゲートウェイ', '品川')).toBe(2);
  });

  it('単一路線しか通らない区間は時刻表どおりの積算値になる', () => {
    // 三田線 志村坂上→志村三丁目→蓮根 = 2+2。いずれも他路線が乗り入れないので迂回路がない
    expect(minutes('志村坂上', '蓮根')).toBe(4);
    // 山手線 東京→有楽町→新橋 = 2+2
    expect(minutes('東京', '新橋')).toBe(4);
  });

  it('並行路線があればそちらの短いほうが選ばれる', () => {
    // 銀座線経由は 渋谷→表参道→外苑前→青山一丁目 = 5 だが、
    // 半蔵門線は外苑前を通らないので 2+2 = 4 で着く
    expect(minutes('渋谷', '青山一丁目')).toBe(4);
  });

  it('徒歩連絡しかない駅間は乗換時間そのものになる', () => {
    // 三田(浅草線・三田線)と田町(山手線)を結ぶのは walk.csv の徒歩連絡だけ
    expect(minutes('三田', '田町')).toBe(data.meta.transferMinutes);
  });

  it('主要区間の所要時間が実際の案内と大きくずれない', () => {
    // 公式の乗換案内で概ね次の程度。±5分に収まっていればデータ破損はない
    const cases: [string, string, number][] = [
      ['新宿', '東京', 20],
      ['渋谷', '上野', 30],
      ['池袋', '品川', 35],
      ['東京', '北千住', 25],
    ];
    for (const [a, b, expected] of cases) {
      expect(minutes(a, b), `${a}→${b}`).toBeGreaterThan(expected - 8);
      expect(minutes(a, b), `${a}→${b}`).toBeLessThan(expected + 8);
    }
  });
});

describe('おまけモード（未開業路線）', () => {
  // このブロックはグループを付け外しするので、毎回まっさらな Network を使う
  const fresh = () => new Network(JSON.parse(JSON.stringify(data)) as NetworkData);

  it('既定では無効で、未開業駅は存在しない', () => {
    const n = fresh();
    expect(n.groups.size).toBe(0);
    expect(n.activeStations()).toHaveLength(248);
    for (const name of ['晴海', '豊洲市場', '有明', '新銀座', '新築地', '枝川', '千石(江東)']) {
      const s = n.findByName(name);
      expect(s, name).toBeDefined();
      expect(n.isStationActive(s!.id), name).toBe(false);
    }
  });

  it('未開業駅は経路計算からも外れる', () => {
    const n = fresh();
    const m = n.travelMinutesFrom(n.findByName('東京')!.id);
    expect(m[n.findByName('晴海')!.id]).toBe(Infinity);
  });

  it('臨海地下鉄を有効にすると東京〜勝どきが大幅に近くなる', () => {
    const before = fresh();
    const tokyo = before.findByName('東京')!.id;
    const kachidoki = before.findByName('勝どき')!.id;
    const beforeMinutes = before.travelMinutesFrom(tokyo)[kachidoki]!;

    const after = fresh();
    after.setActiveGroups(['rinkai']);
    const afterMinutes = after.travelMinutesFrom(tokyo)[kachidoki]!;

    // 公表資料どおり東京→勝どきは3駅・計7分になる
    expect(afterMinutes).toBe(7);
    expect(afterMinutes).toBeLessThan(beforeMinutes);
  });

  it('臨海地下鉄は東京〜有明を公表資料どおり15分で結ぶ', () => {
    const n = fresh();
    n.setActiveGroups(['rinkai']);
    expect(n.travelMinutesFrom(n.findByName('東京')!.id)[n.findByName('有明')!.id]).toBe(15);
    expect(n.activeStations()).toHaveLength(253);
  });

  it('豊住線は直通運転なので豊洲で乗換時間がかからない', () => {
    const n = fresh();
    n.setActiveGroups(['toyosumi']);
    const toyosu = n.findByName('豊洲')!.id;
    // 公表資料どおり豊洲〜住吉 約9分。乗換5分が乗ってしまうと14分になる
    expect(n.travelMinutesFrom(toyosu)[n.findByName('住吉')!.id]).toBe(9);
  });

  it('豊住線がないと豊洲〜住吉は遠回りになる', () => {
    const n = fresh();
    expect(n.travelMinutesFrom(n.findByName('豊洲')!.id)[n.findByName('住吉')!.id]).toBeGreaterThan(
      9,
    );
  });

  it('グループを外すと元に戻る', () => {
    const n = fresh();
    const tokyo = n.findByName('東京')!.id;
    const kachidoki = n.findByName('勝どき')!.id;
    const original = n.travelMinutesFrom(tokyo)[kachidoki]!;
    n.setActiveGroups(['rinkai', 'toyosumi']);
    expect(n.activeStations()).toHaveLength(255);
    n.setActiveGroups([]);
    expect(n.activeStations()).toHaveLength(248);
    expect(n.travelMinutesFrom(tokyo)[kachidoki]).toBe(original);
  });

  it('未知のグループ id は無視される', () => {
    const n = fresh();
    n.setActiveGroups(['そんなものはない']);
    expect(n.groups.size).toBe(0);
    expect(n.activeStations()).toHaveLength(248);
  });

  it('おまけ路線の駅は既存駅と正しくつながる', () => {
    const n = fresh();
    n.setActiveGroups(['rinkai', 'toyosumi']);
    for (const s of n.activeStations()) {
      const m = n.travelMinutesFrom(s.id);
      const unreachable = n.activeStations().filter((t) => !Number.isFinite(m[t.id]!));
      expect(unreachable.map((t) => t.name), `${s.name} から`).toEqual([]);
    }
  });
});

describe('reachStats', () => {
  it('「30分でどこまで行けるか」を集計できる', () => {
    const stats = reachStats(network.travelMinutesFrom(id('東京')));
    expect(stats.reachable).toBe(network.activeStations().length);
    const within30 = stats.within.find((w) => w.minutes === 30)!;
    expect(within30.count).toBeGreaterThan(0);
    expect(within30.count).toBeLessThanOrEqual(stats.reachable);
    // 閾値が大きいほど到達駅数は単調増加する
    const counts = stats.within.map((w) => w.count);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(stats.farthest).not.toBeNull();
  });

  it('中央値は到達時間の真ん中', () => {
    const stats = reachStats(Float64Array.from([0, 2, 4, 6]));
    expect(stats.median).toBe(3);
    expect(reachStats(Float64Array.from([1, 5, 9])).median).toBe(5);
  });

  it('到達不能な駅は集計から除かれる', () => {
    const stats = reachStats(Float64Array.from([0, 10, Infinity]));
    expect(stats.total).toBe(3);
    expect(stats.reachable).toBe(2);
    expect(stats.farthest).toEqual({ stationId: 1, minutes: 10 });
  });
});
