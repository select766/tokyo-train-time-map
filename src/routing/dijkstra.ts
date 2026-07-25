/**
 * 二分ヒープつきダイクストラ法。
 *
 * 旧実装は未訪問頂点を毎回線形走査する O(V^2) だったため、路線を増やすと
 * 中心駅の切り替えが目に見えて遅くなった。ヒープ版は O(E log V)。
 */

/** adjacency[u] = [v0, w0, v1, w1, ...] を平坦化したもの */
export interface AdjacencyList {
  /** 頂点数 */
  size: number;
  /** offsets[u] .. offsets[u+1] が頂点 u の隣接範囲 */
  offsets: Int32Array;
  targets: Int32Array;
  weights: Float64Array;
}

export function buildAdjacency(
  size: number,
  edges: readonly { a: number; b: number; minutes: number }[],
): AdjacencyList {
  const degree = new Int32Array(size);
  for (const e of edges) {
    degree[e.a]!++;
    degree[e.b]!++;
  }
  const offsets = new Int32Array(size + 1);
  for (let i = 0; i < size; i++) offsets[i + 1] = offsets[i]! + degree[i]!;
  const total = offsets[size]!;
  const targets = new Int32Array(total);
  const weights = new Float64Array(total);
  const cursor = Int32Array.from(offsets.subarray(0, size));
  for (const e of edges) {
    let i = cursor[e.a]!++;
    targets[i] = e.b;
    weights[i] = e.minutes;
    i = cursor[e.b]!++;
    targets[i] = e.a;
    weights[i] = e.minutes;
  }
  return { size, offsets, targets, weights };
}

/**
 * 複数の始点（コスト0）から各頂点への最短距離を返す。
 * 到達不能な頂点は Infinity。
 */
export function shortestPaths(adj: AdjacencyList, sources: readonly number[]): Float64Array {
  const dist = new Float64Array(adj.size).fill(Infinity);
  // push 回数は「緩和が成功した回数」以下、すなわち有向辺数 + 始点数を超えない
  const heap = new MinHeap(adj.targets.length + sources.length);
  for (const s of sources) {
    if (dist[s] === 0) continue;
    dist[s] = 0;
    heap.push(s, 0);
  }

  while (heap.size > 0) {
    const u = heap.popMin();
    const du = heap.lastPoppedKey;
    // 古いエントリ（すでにより短い経路が見つかっている）はスキップ
    if (du > dist[u]!) continue;
    const end = adj.offsets[u + 1]!;
    for (let i = adj.offsets[u]!; i < end; i++) {
      const v = adj.targets[i]!;
      const nd = du + adj.weights[i]!;
      if (nd < dist[v]!) {
        dist[v] = nd;
        heap.push(v, nd);
      }
    }
  }
  return dist;
}

/** 遅延削除方式の二分ヒープ（decrease-key の代わりに重複 push を許す） */
class MinHeap {
  private readonly values: Int32Array;
  private readonly keys: Float64Array;
  size = 0;
  lastPoppedKey = 0;

  constructor(capacity: number) {
    this.values = new Int32Array(Math.max(16, capacity));
    this.keys = new Float64Array(Math.max(16, capacity));
  }

  push(value: number, key: number): void {
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.values[i] = this.values[parent]!;
      this.keys[i] = this.keys[parent]!;
      i = parent;
    }
    this.values[i] = value;
    this.keys[i] = key;
  }

  popMin(): number {
    const top = this.values[0]!;
    this.lastPoppedKey = this.keys[0]!;
    const last = --this.size;
    if (last > 0) {
      const value = this.values[last]!;
      const key = this.keys[last]!;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= last) break;
        const right = left + 1;
        const child = right < last && this.keys[right]! < this.keys[left]! ? right : left;
        if (this.keys[child]! >= key) break;
        this.values[i] = this.values[child]!;
        this.keys[i] = this.keys[child]!;
        i = child;
      }
      this.values[i] = value;
      this.keys[i] = key;
    }
    return top;
  }
}
