/** 表示状態を URL に持たせ、そのまま共有できるようにする */
export interface UrlState {
  center?: string;
  scale?: number;
  /** 有効にしているおまけモードのグループ id */
  extra?: string[];
  /** ゆがみの背景色を出しているか */
  field?: boolean;
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(location.search);
  const center = params.get('center') ?? undefined;
  const rawScale = params.get('scale');
  const scale = rawScale === null ? undefined : Number(rawScale);
  const rawExtra = params.get('extra');
  return {
    center,
    scale: scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : undefined,
    extra: rawExtra === null ? undefined : rawExtra.split(',').filter((s) => s.length > 0),
    field: params.get('field') === '1' ? true : undefined,
  };
}

export function writeUrlState(state: UrlState): void {
  const params = new URLSearchParams(location.search);
  if (state.center) params.set('center', state.center);
  if (state.scale !== undefined) params.set('scale', String(Math.round(state.scale * 10) / 10));
  if (state.extra !== undefined) {
    if (state.extra.length > 0) params.set('extra', state.extra.join(','));
    else params.delete('extra');
  }
  if (state.field !== undefined) {
    if (state.field) params.set('field', '1');
    else params.delete('field');
  }
  // 中心駅の切り替えで履歴を汚さない
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
