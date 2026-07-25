import { describe, expect, it } from 'vitest';
import { buildAdjacency, shortestPaths } from '../../src/routing/dijkstra.ts';

describe('shortestPaths', () => {
  it('手計算できる小さなグラフで最短距離が一致する', () => {
    //   0 --1-- 1 --2-- 2
    //   |               |
    //   +------10-------+
    const adj = buildAdjacency(3, [
      { a: 0, b: 1, minutes: 1 },
      { a: 1, b: 2, minutes: 2 },
      { a: 0, b: 2, minutes: 10 },
    ]);
    expect([...shortestPaths(adj, [0])]).toEqual([0, 1, 3]);
    expect([...shortestPaths(adj, [2])]).toEqual([3, 2, 0]);
  });

  it('迂回路のほうが短い場合にそちらを選ぶ', () => {
    const adj = buildAdjacency(4, [
      { a: 0, b: 3, minutes: 100 },
      { a: 0, b: 1, minutes: 1 },
      { a: 1, b: 2, minutes: 1 },
      { a: 2, b: 3, minutes: 1 },
    ]);
    expect(shortestPaths(adj, [0])[3]).toBe(3);
  });

  it('複数始点はいずれか最短のものが採用される', () => {
    const adj = buildAdjacency(3, [
      { a: 0, b: 1, minutes: 5 },
      { a: 1, b: 2, minutes: 5 },
    ]);
    expect([...shortestPaths(adj, [0, 2])]).toEqual([0, 5, 0]);
  });

  it('到達不能な頂点は Infinity になる', () => {
    const adj = buildAdjacency(3, [{ a: 0, b: 1, minutes: 1 }]);
    expect(shortestPaths(adj, [0])[2]).toBe(Infinity);
  });

  it('孤立点しかなくても落ちない', () => {
    const adj = buildAdjacency(2, []);
    expect([...shortestPaths(adj, [0])]).toEqual([0, Infinity]);
  });

  it('多重辺があっても最小の重みが使われる', () => {
    const adj = buildAdjacency(2, [
      { a: 0, b: 1, minutes: 9 },
      { a: 0, b: 1, minutes: 2 },
    ]);
    expect(shortestPaths(adj, [0])[1]).toBe(2);
  });
});
