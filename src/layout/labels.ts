import type { Placement } from './polar.ts';

export interface LabelBox {
  stationId: number;
  /** ラベル中心 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 駅の実位置。ラベルをずらした場合はここへ引き出し線を引く */
  anchorX: number;
  anchorY: number;
  /** ずらした結果、駅位置から離れているか */
  displaced: boolean;
}

export interface LabelLayoutInput {
  placements: readonly Placement[];
  /** 表示優先度。大きいほど先に場所を確保する */
  score: (stationId: number) => number;
  /** ラベルの実寸 */
  measure: (stationId: number) => { width: number; height: number };
  centerStationId: number;
}

export interface LabelLayout {
  /** 表示できたラベル */
  labels: LabelBox[];
  /** 場所を確保できず点だけ表示する駅 */
  hidden: Set<number>;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const PADDING = 2;

/**
 * 駅ラベルの重なりを解消する。
 *
 * 旧実装は重なったラベルを単に非表示にしていたので、新宿・大手町の周辺で
 * 情報が大量に落ちていた。ここでは半径（＝所要時間）を保ったまま接線方向に
 * 少しずらすことを試し、それでも駄目な場合にだけ非表示にする。
 * 半径を変えないので「画面上の距離＝所要時間」という不変条件は壊れない。
 */
export function layoutLabels(input: LabelLayoutInput): LabelLayout {
  const { placements, score, measure, centerStationId } = input;

  const order = placements
    .filter((p) => p.reachable)
    .sort((a, b) => {
      if (a.stationId === centerStationId) return -1;
      if (b.stationId === centerStationId) return 1;
      return score(b.stationId) - score(a.stationId);
    });

  const occupied: Rect[] = [];
  const labels: LabelBox[] = [];
  const hidden = new Set<number>();

  for (const p of order) {
    const { width, height } = measure(p.stationId);
    // 接線方向（半径に直交）。中心駅は半径0なので真横に逃がす
    const tx = -Math.sin(p.angle);
    const ty = Math.cos(p.angle);
    const step = height * 1.05;

    let placed = false;
    for (const k of CANDIDATE_STEPS) {
      const x = p.x + tx * step * k;
      const y = p.y + ty * step * k;
      const rect = {
        left: x - width / 2 - PADDING,
        right: x + width / 2 + PADDING,
        top: y - height / 2 - PADDING,
        bottom: y + height / 2 + PADDING,
      };
      if (occupied.some((o) => intersects(o, rect))) continue;
      occupied.push(rect);
      labels.push({
        stationId: p.stationId,
        x,
        y,
        width,
        height,
        anchorX: p.x,
        anchorY: p.y,
        displaced: k !== 0,
      });
      placed = true;
      break;
    }
    if (!placed) hidden.add(p.stationId);
  }

  for (const p of placements) {
    if (!p.reachable) hidden.add(p.stationId);
  }
  return { labels, hidden };
}

/** 0 を最初に試し、以後は接線方向に交互に離れていく */
const CANDIDATE_STEPS = [0, 1, -1, 2, -2, 3, -3];

function intersects(a: Rect, b: Rect): boolean {
  return (
    Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
  );
}

/** 駅名の描画幅をキャッシュつきで測る */
export class TextMeasurer {
  private readonly cache = new Map<string, { width: number; height: number }>();
  private readonly ctx: CanvasRenderingContext2D;
  private fontSize = 15;

  constructor(private readonly fontFamily: string) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D コンテキストを取得できません');
    this.ctx = ctx;
  }

  setFontSize(size: number): void {
    if (size === this.fontSize) return;
    this.fontSize = size;
    this.cache.clear();
  }

  measure(text: string): { width: number; height: number } {
    const cached = this.cache.get(text);
    if (cached) return cached;
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    const m = this.ctx.measureText(text);
    // 上下に少し余白を持たせた行の高さ
    const size = { width: m.width + this.fontSize * 0.4, height: this.fontSize * 1.35 };
    this.cache.set(text, size);
    return size;
  }
}
