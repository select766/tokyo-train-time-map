/** 表示状態を URL に持たせ、そのまま共有できるようにする */
export interface UrlState {
  center?: string;
  scale?: number;
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(location.search);
  const center = params.get('center') ?? undefined;
  const rawScale = params.get('scale');
  const scale = rawScale === null ? undefined : Number(rawScale);
  return {
    center,
    scale: scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : undefined,
  };
}

export function writeUrlState(state: UrlState): void {
  const params = new URLSearchParams(location.search);
  if (state.center) params.set('center', state.center);
  if (state.scale !== undefined) params.set('scale', String(Math.round(state.scale * 10) / 10));
  // 中心駅の切り替えで履歴を汚さない
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
