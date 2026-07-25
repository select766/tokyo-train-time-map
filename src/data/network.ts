import type { Line, NetworkData, OptionalGroup, Station } from './schema.ts';
import { buildAdjacency, shortestPaths, type AdjacencyList } from '../routing/dijkstra.ts';

/**
 * ネットワークデータに索引と経路計算をかぶせたもの。
 * アプリ側はこれ越しにデータへ触る。
 *
 * おまけモードの未開業路線は、有効なグループを切り替えることで出し入れする。
 * データ自体は常に全部を持ち、無効なグループに属するノードを経路計算から外す。
 */
export class Network {
  readonly lines: readonly Line[];
  readonly stations: readonly Station[];
  readonly optionalGroups: readonly OptionalGroup[];
  private adjacency: AdjacencyList;
  private activeGroups = new Set<string>();
  private readonly stationOfNode: Int32Array;
  private readonly lineById: Map<number, Line>;
  private readonly stationByName: Map<string, Station>;

  constructor(readonly data: NetworkData) {
    this.lines = data.lines;
    this.stations = data.stations;
    this.optionalGroups = data.optionalGroups;
    this.stationOfNode = new Int32Array(data.nodes.length);
    for (const node of data.nodes) this.stationOfNode[node.id] = node.stationId;
    this.lineById = new Map(data.lines.map((l) => [l.id, l]));
    this.stationByName = new Map(data.stations.map((s) => [s.name, s]));
    this.adjacency = this.buildActiveAdjacency();
  }

  // --- おまけモード ----------------------------------------------------

  /** 有効になっているおまけグループ */
  get groups(): ReadonlySet<string> {
    return this.activeGroups;
  }

  setActiveGroups(groups: Iterable<string>): void {
    const next = new Set([...groups].filter((g) => this.optionalGroups.some((o) => o.id === g)));
    this.activeGroups = next;
    this.adjacency = this.buildActiveAdjacency();
  }

  isLineActive(lineId: number): boolean {
    const group = this.line(lineId).group;
    return group === null || this.activeGroups.has(group);
  }

  isNodeActive(nodeId: number): boolean {
    const node = this.data.nodes[nodeId];
    return node !== undefined && this.isLineActive(node.lineId);
  }

  /** 有効な路線が1本でも乗り入れていれば、その駅は存在する */
  isStationActive(stationId: number): boolean {
    return this.station(stationId).nodeIds.some((n) => this.isNodeActive(n));
  }

  /** 表示対象の駅（おまけが無効なら未開業駅は含まれない） */
  activeStations(): Station[] {
    return this.stations.filter((s) => this.isStationActive(s.id));
  }

  private buildActiveAdjacency(): AdjacencyList {
    // 端点のどちらかが無効なノードなら、そのエッジは通れない
    const edges = this.data.edges.filter((e) => this.isNodeActive(e.a) && this.isNodeActive(e.b));
    return buildAdjacency(this.data.nodes.length, edges);
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
    const sources = this.station(centerStationId).nodeIds.filter((n) => this.isNodeActive(n));
    const nodeCost = shortestPaths(this.adjacency, sources);
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
