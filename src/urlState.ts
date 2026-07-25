/** 表示状態を URL に持たせ、そのまま共有できるようにする */
export interface UrlState {
  center?: string;
  scale?: number;
  /** 有効にしているおまけモードのグループ id */
  extra?: string[];
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
  // 中心駅の切り替えで履歴を汚さない
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
