import type { Network } from '../data/network.ts';
import { layoutPolar, type Placement } from '../layout/polar.ts';
import { layoutLabels, TextMeasurer, type LabelBox } from '../layout/labels.ts';
import { computeDistortionField, type DistortionField } from '../layout/distortion.ts';
import { paintDistortion, type ColorScheme } from './distortionPaint.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_FAMILY =
  '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

const ANIMATION_MS = 700;
const MIN_PX_PER_MINUTE = 2;
const MAX_PX_PER_MINUTE = 200;
/** これ以上動いたらクリックではなくドラッグとみなす */
const CLICK_SLOP_PX = 5;

export interface MapViewOptions {
  network: Network;
  centerStationId: number;
  pxPerMinute: number;
  fontSize: number;
  onCenterChange: (stationId: number) => void;
  onHover: (stationId: number | null) => void;
}

interface StationVisual {
  dot: SVGCircleElement;
  label: SVGGElement;
  labelRect: SVGRectElement;
  labelText: SVGTextElement;
  leader: SVGLineElement;
}

interface DrawEdge {
  /** 駅 id */
  a: number;
  b: number;
  /** 乗車エッジなら路線 id、徒歩連絡なら null */
  lineId: number | null;
  el: SVGLineElement;
}

/**
 * タイムマップの描画とポインタ操作。
 *
 * 座標系は「中心駅が原点、1分 = pxPerMinute ピクセル」。
 * 拡大はビューポートの transform ではなく pxPerMinute の変更で行う。
 * こうしないと駅名の文字まで拡大されてしまう。
 */
export class MapView {
  private readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private readonly fieldImage: SVGImageElement;
  private readonly ringGroup: SVGGElement;
  private readonly edgeGroup: SVGGElement;
  private readonly leaderGroup: SVGGElement;
  private readonly dotGroup: SVGGElement;
  private readonly labelGroup: SVGGElement;

  private readonly network: Network;
  private readonly measurer: TextMeasurer;
  private readonly visuals = new Map<number, StationVisual>();
  private readonly edges: DrawEdge[] = [];
  private readonly rings: { minutes: number; circle: SVGCircleElement; texts: SVGTextElement[] }[] =
    [];

  private centerStationId: number;
  private pxPerMinute: number;
  private fontSize: number;
  private minutes: Float64Array;
  private placements: Placement[];
  private labels = new Map<number, LabelBox>();
  private hidden = new Set<number>();

  /** アニメーション中の実座標 */
  private currentX: Float64Array;
  private currentY: Float64Array;
  private fromX: Float64Array;
  private fromY: Float64Array;
  private animationStart = 0;
  private animationFrame = 0;

  private offsetX = 0;
  private offsetY = 0;

  private showField = false;
  private colorScheme: ColorScheme = 'light';
  private field: DistortionField | null = null;

  private readonly onCenterChange: (stationId: number) => void;
  private readonly onHover: (stationId: number | null) => void;

  constructor(container: HTMLElement, options: MapViewOptions) {
    this.network = options.network;
    this.centerStationId = options.centerStationId;
    this.pxPerMinute = options.pxPerMinute;
    this.fontSize = options.fontSize;
    this.onCenterChange = options.onCenterChange;
    this.onHover = options.onHover;
    this.measurer = new TextMeasurer(FONT_FAMILY);
    this.measurer.setFontSize(this.fontSize);

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'map');
    this.svg.setAttribute('role', 'application');
    this.svg.setAttribute('aria-label', '所要時間タイムマップ');
    container.appendChild(this.svg);

    this.viewport = this.group(this.svg, 'viewport');
    // 歪みの面は最背面。viewport の子なのでパンは transform 任せでよい
    this.fieldImage = document.createElementNS(SVG_NS, 'image');
    this.fieldImage.setAttribute('class', 'field');
    this.fieldImage.style.display = 'none';
    this.viewport.appendChild(this.fieldImage);
    this.ringGroup = this.group(this.viewport, 'rings');
    this.edgeGroup = this.group(this.viewport, 'edges');
    this.leaderGroup = this.group(this.viewport, 'leaders');
    this.dotGroup = this.group(this.viewport, 'dots');
    this.labelGroup = this.group(this.viewport, 'labels');

    const count = this.network.stations.length;
    this.currentX = new Float64Array(count);
    this.currentY = new Float64Array(count);
    this.fromX = new Float64Array(count);
    this.fromY = new Float64Array(count);

    this.createRings();
    this.createEdges();
    this.createStations();

    this.minutes = this.network.travelMinutesFrom(this.centerStationId);
    this.placements = layoutPolar(this.network, this.centerStationId, this.minutes, this.pxPerMinute);
    for (const p of this.placements) {
      this.currentX[p.stationId] = p.x;
      this.currentY[p.stationId] = p.y;
    }
    this.relayoutLabels();
    this.paint();

    this.attachPointerHandlers();
  }

  // --- 公開 API --------------------------------------------------------

  get center(): number {
    return this.centerStationId;
  }

  get scale(): number {
    return this.pxPerMinute;
  }

  get travelMinutes(): Float64Array {
    return this.minutes;
  }

  setCenter(stationId: number, animate = true): void {
    if (stationId === this.centerStationId) return;
    this.centerStationId = stationId;
    this.minutes = this.network.travelMinutesFrom(stationId);
    this.recomputeLayout(animate);
    if (this.showField) this.rebuildField();
    this.centerOnViewport();
    this.onCenterChange(stationId);
  }

  /**
   * 倍率を変える。focus を渡すと、その点（SVG 左上を原点とする座標）の真下にある
   * 地図上の地点が動かないように平行移動を補正する。省略した場合は画面中央を固定する。
   */
  setScale(pxPerMinute: number, focus?: { x: number; y: number }): void {
    const next = clamp(pxPerMinute, MIN_PX_PER_MINUTE, MAX_PX_PER_MINUTE);
    if (next === this.pxPerMinute) return;
    const ratio = next / this.pxPerMinute;

    // 駅の座標は倍率に比例するので、画面座標は offset + (画面座標 - offset) * ratio に移る。
    // これが focus で不動になるよう offset を解く。
    const anchor = focus ?? this.viewportCenter();
    this.offsetX = anchor.x - (anchor.x - this.offsetX) * ratio;
    this.offsetY = anchor.y - (anchor.y - this.offsetY) * ratio;

    this.pxPerMinute = next;
    this.applyViewportTransform();
    this.recomputeLayout(false);
  }

  private viewportCenter(): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  /**
   * おまけモードの路線を出し入れする。
   * 中心駅が未開業駅だった場合、それが消えると原点が無くなるので東京駅へ退避する。
   */
  setActiveGroups(groups: Iterable<string>): void {
    this.network.setActiveGroups(groups);
    if (!this.network.isStationActive(this.centerStationId)) {
      const fallback = this.network.findByName('東京') ?? this.network.activeStations()[0];
      if (fallback) this.centerStationId = fallback.id;
    }
    this.minutes = this.network.travelMinutesFrom(this.centerStationId);
    this.recomputeLayout(true);
    if (this.showField) this.rebuildField();
    this.onCenterChange(this.centerStationId);
  }

  /** 直線距離と時間距離のずれを背景色で示す */
  setFieldVisible(visible: boolean): void {
    if (visible === this.showField) return;
    this.showField = visible;
    if (visible) this.rebuildField();
    else this.fieldImage.style.display = 'none';
  }

  get fieldVisible(): boolean {
    return this.showField;
  }

  /** 明暗どちらの配色を使うか。地の色が変わると読める段が変わる */
  setColorScheme(scheme: ColorScheme): void {
    if (scheme === this.colorScheme) return;
    this.colorScheme = scheme;
    if (this.showField) this.rebuildField();
  }

  private rebuildField(): void {
    // 場は「分」座標系で作るので、拡大縮小しても作り直す必要はない
    const positions = this.placements.map((p) => ({
      stationId: p.stationId,
      x: p.x / this.pxPerMinute,
      y: p.y / this.pxPerMinute,
      reachable: p.reachable,
    }));
    this.field = computeDistortionField(this.network, this.centerStationId, this.minutes, positions);
    if (this.field.sampleCount === 0) {
      this.fieldImage.style.display = 'none';
      return;
    }
    this.fieldImage.setAttribute('href', paintDistortion(this.field, this.colorScheme));
    this.fieldImage.style.display = '';
    this.placeFieldImage();
  }

  /** 場の画像を現在の倍率にあわせて配置する */
  private placeFieldImage(): void {
    if (!this.field) return;
    const half = this.field.extent * this.pxPerMinute;
    this.fieldImage.setAttribute('x', fmt(-half));
    this.fieldImage.setAttribute('y', fmt(-half));
    this.fieldImage.setAttribute('width', fmt(half * 2));
    this.fieldImage.setAttribute('height', fmt(half * 2));
  }

  setFontSize(size: number): void {
    if (size === this.fontSize) return;
    this.fontSize = size;
    this.measurer.setFontSize(size);
    for (const visual of this.visuals.values()) {
      visual.labelText.setAttribute('font-size', String(size));
    }
    this.relayoutLabels();
    this.paint();
  }

  resize(): void {
    this.centerOnViewport();
  }

  /** 中心駅から最も遠い駅の所要時間［分］ */
  private farthestMinutes(): number {
    let max = 0;
    for (const m of this.minutes) {
      if (Number.isFinite(m) && m > max) max = m;
    }
    return max;
  }

  /** 到達可能な全駅が収まる倍率にして中心へ戻す */
  fitToContent(): void {
    const maxMinutes = this.farthestMinutes();
    if (maxMinutes <= 0) return;
    const rect = this.svg.getBoundingClientRect();
    // ラベルのはみ出しぶんを見込んで少し余白を取る
    const radius = (Math.min(rect.width, rect.height) / 2) * 0.88;
    this.centerOnViewport();
    this.pxPerMinute = clamp(radius / maxMinutes, MIN_PX_PER_MINUTE, MAX_PX_PER_MINUTE);
    this.recomputeLayout(true);
  }

  /** 中心駅を画面中央に置く */
  centerOnViewport(): void {
    const rect = this.svg.getBoundingClientRect();
    this.offsetX = rect.width / 2;
    this.offsetY = rect.height / 2;
    this.applyViewportTransform();
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.svg.remove();
  }

  // --- 生成 ------------------------------------------------------------

  private group(parent: Element, className: string): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', className);
    parent.appendChild(g);
    return g;
  }

  private createRings(): void {
    for (let minutes = 10; minutes <= 120; minutes += 10) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', '0');
      circle.setAttribute('cy', '0');
      circle.setAttribute('class', minutes === 30 ? 'ring ring--highlight' : 'ring');
      this.ringGroup.appendChild(circle);
      // 円は画面外まで広がるので、上下左右の4か所に目盛を置いて
      // どこにパンしてもどれかが視界に入るようにする
      const texts = RING_LABEL_ANGLES.map(() => {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute(
          'class',
          minutes === 30 ? 'ring-label ring-label--highlight' : 'ring-label',
        );
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.textContent = `${minutes}分`;
        this.ringGroup.appendChild(text);
        return text;
      });
      this.rings.push({ minutes, circle, texts });
    }
  }

  private createEdges(): void {
    const seen = new Set<string>();
    for (const edge of this.network.data.edges) {
      const nodeA = this.network.data.nodes[edge.a]!;
      const nodeB = this.network.data.nodes[edge.b]!;
      const a = nodeA.stationId;
      const b = nodeB.stationId;
      // 同一駅内の乗換は長さ0なので描かない
      if (a === b) continue;
      const key = `${Math.min(a, b)},${Math.max(a, b)},${edge.lineId ?? 'w'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const el = document.createElementNS(SVG_NS, 'line');
      if (edge.lineId === null) {
        el.setAttribute('class', 'edge edge--transfer');
      } else if (this.network.isBypassLine(edge.lineId)) {
        // 私鉄バイパス区間は路線色を使わず、灰色の太い点線で描く
        el.setAttribute('class', 'edge edge--bypass');
      } else {
        const line = this.network.line(edge.lineId);
        // 未開業路線は破線で描き、開業済みの路線と区別する
        el.setAttribute(
          'class',
          this.network.isPlannedLine(edge.lineId) ? 'edge edge--planned' : 'edge',
        );
        el.setAttribute('stroke', line.color);
      }
      this.edgeGroup.appendChild(el);
      this.edges.push({ a, b, lineId: edge.lineId, el });
    }
  }

  private createStations(): void {
    for (const station of this.network.stations) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'dot');
      dot.setAttribute('r', '4');
      dot.dataset['station'] = String(station.id);
      this.dotGroup.appendChild(dot);

      const leader = document.createElementNS(SVG_NS, 'line');
      leader.setAttribute('class', 'leader');
      this.leaderGroup.appendChild(leader);

      const label = document.createElementNS(SVG_NS, 'g');
      label.setAttribute('class', 'label');
      label.dataset['station'] = String(station.id);
      const labelRect = document.createElementNS(SVG_NS, 'rect');
      labelRect.setAttribute('rx', '3');
      const labelText = document.createElementNS(SVG_NS, 'text');
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('dominant-baseline', 'central');
      labelText.setAttribute('font-size', String(this.fontSize));
      labelText.textContent = station.name;
      label.append(labelRect, labelText);
      this.labelGroup.appendChild(label);

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = station.name;
      dot.appendChild(title);

      this.visuals.set(station.id, { dot, label, labelRect, labelText, leader });
    }
  }

  // --- レイアウト ------------------------------------------------------

  private recomputeLayout(animate: boolean): void {
    this.fromX.set(this.currentX);
    this.fromY.set(this.currentY);
    this.placements = layoutPolar(this.network, this.centerStationId, this.minutes, this.pxPerMinute);
    this.relayoutLabels();

    if (!animate) {
      for (const p of this.placements) {
        this.currentX[p.stationId] = p.x;
        this.currentY[p.stationId] = p.y;
      }
      this.paint();
      return;
    }
    cancelAnimationFrame(this.animationFrame);
    this.animationStart = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - this.animationStart) / ANIMATION_MS);
      const e = easeInOutCubic(t);
      for (const p of this.placements) {
        const id = p.stationId;
        this.currentX[id] = this.fromX[id]! + (p.x - this.fromX[id]!) * e;
        this.currentY[id] = this.fromY[id]! + (p.y - this.fromY[id]!) * e;
      }
      this.paint();
      if (t < 1) this.animationFrame = requestAnimationFrame(step);
    };
    this.animationFrame = requestAnimationFrame(step);
  }

  private relayoutLabels(): void {
    const result = layoutLabels({
      placements: this.placements,
      centerStationId: this.centerStationId,
      score: (id) => this.network.labelScore(this.network.station(id)),
      measure: (id) => this.measurer.measure(this.network.station(id).name),
    });
    this.labels = new Map(result.labels.map((l) => [l.stationId, l]));
    this.hidden = result.hidden;
  }

  // --- 描画 ------------------------------------------------------------

  private paint(): void {
    if (this.showField) this.placeFieldImage();

    // 最遠の駅より外側の円は情報を持たないので描かない
    const outermost = Math.ceil(this.farthestMinutes() / 10) * 10;
    for (const ring of this.rings) {
      const visible = ring.minutes <= outermost;
      ring.circle.style.display = visible ? '' : 'none';
      for (const text of ring.texts) text.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const r = ring.minutes * this.pxPerMinute;
      ring.circle.setAttribute('r', String(r));
      ring.texts.forEach((text, i) => {
        const angle = RING_LABEL_ANGLES[i]!;
        text.setAttribute('x', fmt(Math.cos(angle) * r));
        text.setAttribute('y', fmt(Math.sin(angle) * r));
      });
    }

    for (const edge of this.edges) {
      const { el, a, b } = edge;
      // 無効なおまけ路線、および到達できない駅につながる線は描かない
      const visible =
        (edge.lineId === null || this.network.isLineActive(edge.lineId)) &&
        this.placements[a]!.reachable &&
        this.placements[b]!.reachable;
      el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      el.setAttribute('x1', fmt(this.currentX[a]!));
      el.setAttribute('y1', fmt(this.currentY[a]!));
      el.setAttribute('x2', fmt(this.currentX[b]!));
      el.setAttribute('y2', fmt(this.currentY[b]!));
    }

    for (const station of this.network.stations) {
      const id = station.id;
      const visual = this.visuals.get(id)!;
      const x = this.currentX[id]!;
      const y = this.currentY[id]!;
      const isCenter = id === this.centerStationId;
      const placement = this.placements[id]!;

      visual.dot.setAttribute('cx', fmt(x));
      visual.dot.setAttribute('cy', fmt(y));
      visual.dot.setAttribute('class', isCenter ? 'dot dot--center' : 'dot');
      visual.dot.style.display = placement.reachable ? '' : 'none';

      const label = this.labels.get(id);
      if (!label || this.hidden.has(id)) {
        visual.label.style.display = 'none';
        visual.leader.style.display = 'none';
        continue;
      }
      // ラベルは駅位置からの相対オフセットを保ったまま追随させる
      const lx = x + (label.x - label.anchorX);
      const ly = y + (label.y - label.anchorY);
      visual.label.style.display = '';
      visual.label.setAttribute('class', isCenter ? 'label label--center' : 'label');
      visual.labelRect.setAttribute('x', fmt(lx - label.width / 2));
      visual.labelRect.setAttribute('y', fmt(ly - label.height / 2));
      visual.labelRect.setAttribute('width', fmt(label.width));
      visual.labelRect.setAttribute('height', fmt(label.height));
      visual.labelText.setAttribute('x', fmt(lx));
      visual.labelText.setAttribute('y', fmt(ly));

      if (label.displaced) {
        visual.leader.style.display = '';
        visual.leader.setAttribute('x1', fmt(x));
        visual.leader.setAttribute('y1', fmt(y));
        visual.leader.setAttribute('x2', fmt(lx));
        visual.leader.setAttribute('y2', fmt(ly));
      } else {
        visual.leader.style.display = 'none';
      }
    }
  }

  private applyViewportTransform(): void {
    this.viewport.setAttribute('transform', `translate(${fmt(this.offsetX)},${fmt(this.offsetY)})`);
  }

  // --- 操作 ------------------------------------------------------------

  private attachPointerHandlers(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let downAt = { x: 0, y: 0 };
    // ポインタキャプチャを取ると pointerup の target が svg 自身に付け替わるため、
    // 押した時点でどの駅の上だったかを覚えておく必要がある
    let downStation: number | null = null;
    let pinchDistance = 0;

    this.svg.addEventListener('pointerdown', (e) => {
      this.svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        downAt = { x: e.clientX, y: e.clientY };
        downStation = this.stationAt(e.target);
      } else if (pointers.size === 2) {
        dragging = false;
        pinchDistance = distanceBetween(pointers);
      }
    });

    this.svg.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        this.onHover(this.stationAt(e.target));
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const next = distanceBetween(pointers);
        if (pinchDistance > 0 && next > 0) {
          const rect = this.svg.getBoundingClientRect();
          const mid = midpoint(pointers);
          this.setScale(this.pxPerMinute * (next / pinchDistance), {
            x: mid.x - rect.left,
            y: mid.y - rect.top,
          });
        }
        pinchDistance = next;
        return;
      }
      if (dragging) {
        this.offsetX += dx;
        this.offsetY += dy;
        this.applyViewportTransform();
      }
    });

    const endPointer = (e: PointerEvent) => {
      const wasDragging = dragging && pointers.size === 1;
      const stationId = downStation;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) {
        dragging = false;
        downStation = null;
      }

      if (!wasDragging || stationId === null) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      if (moved > CLICK_SLOP_PX) return;
      this.setCenter(stationId);
    };
    this.svg.addEventListener('pointerup', endPointer);
    this.svg.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      dragging = false;
      downStation = null;
      pinchDistance = 0;
    });

    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = this.svg.getBoundingClientRect();
        // 1ノッチあたり約1.2倍。トラックパッドの細かい値にも比例して効く
        const factor = Math.exp(-e.deltaY * 0.002);
        this.setScale(this.pxPerMinute * factor, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      },
      { passive: false },
    );

    this.svg.addEventListener('pointerleave', () => this.onHover(null));
  }

  private stationAt(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest('[data-station]');
    if (!(el instanceof SVGElement)) return null;
    const raw = el.dataset['station'];
    return raw === undefined ? null : Number(raw);
  }
}

/** 目盛ラベルを置く方位（右・下・左・上） */
const RING_LABEL_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** SVG 属性に入れる数値。小数を切り詰めて DOM 更新量を減らす */
function fmt(v: number): string {
  return v.toFixed(1);
}

function distanceBetween(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(pointers: Map<number, { x: number; y: number }>): { x: number; y: number } {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return { x: 0, y: 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
