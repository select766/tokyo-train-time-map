/**
 * アプリとデータパイプラインで共有するネットワークデータのスキーマ。
 *
 * グラフは「駅」ではなく「ノード（＝ある駅のある路線のホーム）」を頂点とする。
 * 新宿の丸ノ内線ホームと大江戸線ホームは別ノードで、両者は乗換エッジで結ばれる。
 * こうしないと乗換時間を表現できない。
 */

/** 路線 */
export interface Line {
  id: number;
  name: string;
  company: string;
  /** #rrggbb */
  color: string;
  /**
   * 常設の路線は null。おまけモードで切り替えられる路線は、
   * どのグループ（OptionalGroup）に属するかを表す id が入る。
   */
  group: string | null;
}

/**
 * おまけモードで切り替えられる路線のまとまり。
 * category: 'plan' = 未開業・計画中の路線（破線で描画）。
 *           'existing' = 既に運行中だが対応範囲外の路線（実線・路線色で描画）。
 *           'bypass' = 既存駅同士を結ぶ私鉄の短絡区間（灰色の太い点線で描画）。
 */
export interface OptionalGroup {
  id: string;
  name: string;
  description: string;
  category: 'plan' | 'existing' | 'bypass';
}

/** 駅（同名の複数路線ホームをまとめたもの） */
export interface Station {
  id: number;
  name: string;
  lat: number;
  lon: number;
  /** ラベル表示の優先度。大きいほど優先。手動CSVの「優先度」列由来 */
  priority: number;
  /** この駅に属するノード id */
  nodeIds: number[];
  /** この駅に乗り入れる路線 id（表示順は lines の順） */
  lineIds: number[];
}

/** ノード＝ある駅のある路線のホーム */
export interface Node {
  id: number;
  stationId: number;
  lineId: number;
}

/** ノード間のエッジ */
export interface Edge {
  a: number;
  b: number;
  /** 所要時間［分］ */
  minutes: number;
  /** 乗車エッジなら路線 id、乗換・徒歩連絡エッジなら null */
  lineId: number | null;
}

export interface NetworkMeta {
  /** データ生成日時 (ISO8601) */
  generatedAt: string;
  /** 所要時間データの基準時点 */
  timetableBasis: string;
  /** 一律の乗換・徒歩連絡時間［分］ */
  transferMinutes: number;
  sources: string[];
  notes: string[];
}

export interface NetworkData {
  meta: NetworkMeta;
  lines: Line[];
  optionalGroups: OptionalGroup[];
  stations: Station[];
  nodes: Node[];
  edges: Edge[];
}
