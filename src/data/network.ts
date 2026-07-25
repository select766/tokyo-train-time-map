import type { Line, NetworkData, Station } from './schema.ts';
import { buildAdjacency, shortestPaths, type AdjacencyList } from '../routing/dijkstra.ts';

/**
 * ネットワークデータに索引と経路計算をかぶせたもの。
 * アプリ側はこれ越しにデータへ触る。
 */
export class Network {
  readonly lines: readonly Line[];
  readonly stations: readonly Station[];
  private readonly adjacency: AdjacencyList;
  private readonly stationOfNode: Int32Array;
  private readonly lineById: Map<number, Line>;
  private readonly stationByName: Map<string, Station>;

  constructor(readonly data: NetworkData) {
    this.lines = data.lines;
    this.stations = data.stations;
    this.adjacency = buildAdjacency(data.nodes.length, data.edges);
    this.stationOfNode = new Int32Array(data.nodes.length);
    for (const node of data.nodes) this.stationOfNode[node.id] = node.stationId;
    this.lineById = new Map(data.lines.map((l) => [l.id, l]));
    this.stationByName = new Map(data.stations.map((s) => [s.name, s]));
  }

  line(id: number): Line {
    const l = this.lineById.get(id);
    if (!l) throw new Error(`未知の路線 id: ${id}`);
    return l;
  }

  station(id: number): Station {
    const s = this.stations[id];
    if (!s) throw new Error(`未知の駅 id: ${id}`);
    return s;
  }

  findByName(name: string): Station | undefined {
    return this.stationByName.get(name);
  }

  /**
   * 中心駅から各駅への所要時間［分］。到達不能なら Infinity。
   * 中心駅のどのホームから出発してもよいので、その全ノードを始点にする。
   */
  travelMinutesFrom(centerStationId: number): Float64Array {
    const nodeCost = shortestPaths(this.adjacency, this.station(centerStationId).nodeIds);
    const result = new Float64Array(this.stations.length).fill(Infinity);
    for (let node = 0; node < nodeCost.length; node++) {
      const s = this.stationOfNode[node]!;
      const c = nodeCost[node]!;
      if (c < result[s]!) result[s] = c;
    }
    return result;
  }

  /** 駅ラベルの表示優先度。大きいほど先に場所を確保する */
  labelScore(station: Station): number {
    // 手動の優先度を主、乗り入れ路線数を従とする。
    // 大手町・新宿のような結節点は自然に上位に来る。
    return station.priority * 100 + station.lineIds.length * 10;
  }
}

export async function loadNetwork(url: string): Promise<Network> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ネットワークデータの取得に失敗しました: ${res.status}`);
  return new Network((await res.json()) as NetworkData);
}
