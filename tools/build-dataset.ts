/**
 * data/*.csv から public/data/network.json を生成する。
 *
 * 旧 make_dataset/generate_json.py の置き換え。相違点:
 *  - 駅の緯度経度を data/station_locations.csv から引く
 *    （旧版は parosky.net の配布CSVをダウンロードしていたが現在リンク切れ）
 *  - 「徒歩連絡」を疑似路線ではなく lineId=null のエッジとして表現する
 *  - 同名駅の同定・優先度の扱いを明示的にした
 *
 * 使い方: npm run dataset
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Edge,
  Line,
  NetworkData,
  Node,
  OptionalGroup,
  Station,
} from '../src/data/schema.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const OUT = resolve(ROOT, 'public/data/network.json');

/** 一律の乗換・徒歩連絡時間［分］。旧版から据え置き */
const TRANSFER_MINUTES = 5;

// --- CSV ---------------------------------------------------------------

/** ごく単純なCSVリーダ。data/*.csv は引用符を含まないため十分 */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0];
  if (header === undefined) throw new Error(`${path}: 空のCSV`);
  const cols = header.split(',');
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    if (cells.length > cols.length) {
      throw new Error(`${path}:${i + 2}: 列が多すぎます (${cells.length} > ${cols.length})`);
    }
    const row: Record<string, string> = {};
    cols.forEach((c, j) => (row[c] = cells[j] ?? ''));
    return row;
  });
}

// --- build -------------------------------------------------------------

function build(): NetworkData {
  const optionalGroups: OptionalGroup[] = readCsv(resolve(DATA, 'extra_groups.csv')).map((r) => {
    const category = required(r, 'カテゴリ');
    if (category !== 'plan' && category !== 'existing' && category !== 'bypass') {
      throw new Error(
        `extra_groups.csv: 不正なカテゴリ「${category}」（plan / existing / bypass のみ許可）`,
      );
    }
    return {
      id: required(r, 'グループid'),
      name: required(r, '名称'),
      description: required(r, '説明'),
      category,
    };
  });
  const groupIds = new Set(optionalGroups.map((g) => g.id));

  const lines: Line[] = readCsv(resolve(DATA, 'lines.csv')).map((r, i) => {
    const group = r['おまけ'] ?? '';
    if (group && !groupIds.has(group)) {
      throw new Error(`lines.csv: 未定義のおまけグループ「${group}」`);
    }
    return {
      id: i,
      name: required(r, '路線名'),
      company: required(r, '会社名'),
      color: required(r, '色(#RGB)'),
      group: group || null,
    };
  });
  const lineByName = new Map(lines.map((l) => [l.name, l]));

  // 直通運転する路線の組。該当する駅では乗換時間をこの値で上書きする
  const throughServices = new Map<string, number>();
  for (const [i, r] of readCsv(resolve(DATA, 'through_services.csv')).entries()) {
    const a = lineByName.get(required(r, '路線名1', i + 2));
    const b = lineByName.get(required(r, '路線名2', i + 2));
    if (!a || !b) throw new Error(`through_services.csv:${i + 2}: lines.csv にない路線名`);
    const minutes = Number(required(r, '乗換時間', i + 2));
    throughServices.set(throughKey(a.id, b.id, required(r, '駅名', i + 2)), minutes);
  }

  const locations = new Map<string, { lat: number; lon: number }>();
  for (const r of readCsv(resolve(DATA, 'station_locations.csv'))) {
    locations.set(required(r, '駅名'), {
      lat: Number(required(r, '緯度')),
      lon: Number(required(r, '経度')),
    });
  }

  const stations: Station[] = [];
  const stationByName = new Map<string, Station>();
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  /** 路線内での駅番号 → ノード id。路線が変わるたびにリセットする */
  let numberToNode = new Map<string, number>();
  let currentLine: string | null = null;

  for (const [i, row] of readCsv(resolve(DATA, 'stations.csv')).entries()) {
    const lineNo = i + 2;
    const lineName = required(row, '路線名', lineNo);
    const stationName = required(row, '駅名', lineNo);
    const stationNumber = required(row, '駅番号', lineNo);
    const line = lineByName.get(lineName);
    if (!line) throw new Error(`stations.csv:${lineNo}: lines.csv にない路線「${lineName}」`);

    if (currentLine !== lineName) {
      numberToNode = new Map();
      currentLine = lineName;
    }
    if (numberToNode.has(stationNumber)) {
      throw new Error(`stations.csv:${lineNo}: 駅番号「${stationNumber}」が${lineName}内で重複`);
    }

    let station = stationByName.get(stationName);
    if (!station) {
      const loc = locations.get(stationName);
      if (!loc) {
        throw new Error(
          `stations.csv:${lineNo}: 「${stationName}」の緯度経度が station_locations.csv にありません`,
        );
      }
      station = {
        id: stations.length,
        name: stationName,
        lat: loc.lat,
        lon: loc.lon,
        priority: 0,
        nodeIds: [],
        lineIds: [],
      };
      stations.push(station);
      stationByName.set(stationName, station);
    }
    // 優先度は路線ごとに書かれうるので最大値を採用する
    const priority = row['優先度'];
    if (priority) station.priority = Math.max(station.priority, Number(priority));

    const node: Node = { id: nodes.length, stationId: station.id, lineId: line.id };
    nodes.push(node);
    station.nodeIds.push(node.id);
    if (!station.lineIds.includes(line.id)) station.lineIds.push(line.id);
    numberToNode.set(stationNumber, node.id);

    // 隣接駅（同一路線内・すでに出現済みの駅番号を指す）
    for (const n of [1, 2, 3]) {
      const adj = row[`隣接駅番号${n}`];
      if (!adj) continue;
      const to = numberToNode.get(adj);
      if (to === undefined) {
        throw new Error(`stations.csv:${lineNo}: 隣接駅番号「${adj}」が${lineName}内に見つかりません`);
      }
      const minutes = Number(required(row, `所要時間${n}`, lineNo));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error(`stations.csv:${lineNo}: 所要時間${n} が不正です`);
      }
      edges.push({ a: node.id, b: to, minutes, lineId: line.id });
    }
  }

  // 同一駅内の路線間乗換。直通運転の指定がある組はその時間を使う
  for (const station of stations) {
    for (let i = 0; i < station.nodeIds.length; i++) {
      for (let j = i + 1; j < station.nodeIds.length; j++) {
        const a = station.nodeIds[i]!;
        const b = station.nodeIds[j]!;
        const through = throughServices.get(
          throughKey(nodes[a]!.lineId, nodes[b]!.lineId, station.name),
        );
        edges.push({
          a,
          b,
          minutes: through ?? TRANSFER_MINUTES,
          lineId: null,
        });
      }
    }
  }

  // 名前の違う駅同士の徒歩連絡
  for (const [i, row] of readCsv(resolve(DATA, 'walk.csv')).entries()) {
    const a = stationByName.get(required(row, '徒歩乗換駅名1', i + 2));
    const b = stationByName.get(required(row, '徒歩乗換駅名2', i + 2));
    if (!a || !b) {
      throw new Error(`walk.csv:${i + 2}: stations.csv にない駅名が含まれています`);
    }
    for (const na of a.nodeIds) {
      for (const nb of b.nodeIds) {
        edges.push({ a: na, b: nb, minutes: TRANSFER_MINUTES, lineId: null });
      }
    }
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      timetableBasis: '2017年7月時点（虎ノ門ヒルズ・高輪ゲートウェイの開業分のみ2026年7月に追補）',
      transferMinutes: TRANSFER_MINUTES,
      sources: [
        '東京メトロ・都営地下鉄・JR東日本の公開時刻表（駅間所要時間）',
        '駅の緯度経度: 旧 parosky.net 配布データおよびWikipedia（新設駅）',
      ],
      notes: [
        '駅を置く方角は実際の地理どおりで、変えているのは中心からの距離だけです。',
        '中心駅以外の駅同士の所要時間は地図上の距離に反映されません。',
        '快速・急行は考慮していません（JR中央線・総武線・常磐線は快速含む）。',
        '乗換・徒歩連絡は一律5分として計算しています。',
      ],
    },
    lines,
    optionalGroups,
    stations,
    nodes,
    edges,
  };
}

/** 直通運転指定の索引キー。路線の順序は問わない */
function throughKey(lineA: number, lineB: number, station: string): string {
  return `${Math.min(lineA, lineB)},${Math.max(lineA, lineB)},${station}`;
}

function required(row: Record<string, string>, key: string, lineNo?: number): string {
  const v = row[key];
  if (v === undefined || v === '') {
    throw new Error(`${lineNo !== undefined ? `行${lineNo}: ` : ''}列「${key}」が空です`);
  }
  return v;
}

const network = build();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(network));
console.log(
  `${OUT}\n  路線 ${network.lines.length} / 駅 ${network.stations.length} / ` +
    `ノード ${network.nodes.length} / エッジ ${network.edges.length}`,
);
