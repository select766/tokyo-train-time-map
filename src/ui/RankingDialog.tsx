import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Network } from '../data/network.ts';
import { rankStations, type StationRanking } from '../layout/ranking.ts';

interface Props {
  open: boolean;
  network: Network;
  /** グループの付け外しで結果が変わるので、再計算のきっかけとして受け取る */
  activeGroups: ReadonlySet<string>;
  centerStationId: number;
  onSelect: (stationId: number) => void;
  onClose: () => void;
}

type Tab = 'reach' | 'distortion';

const EDGE_COUNT = 20;
const DEFINITION_URL = 'https://github.com/select766/tokyo-train-time-map/blob/master/docs/ranking.md';

/**
 * 駅ランキングのモーダル。
 * 「30分圏内の到達駅数」と「ゆがみ指数」の2本立て。どちらも全表示対象駅を
 * 中心に見立てて計算し直すので、開いたときにまとめて求める。
 *
 * 既定では上位・下位20駅だけを見せる。「全駅表示」で全件に切り替えられる。
 */
export function RankingDialog({
  open,
  network,
  activeGroups,
  centerStationId,
  onSelect,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('reach');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const ranking = useMemo<StationRanking[] | null>(
    () => (open ? rankStations(network) : null),
    [network, activeGroups, open],
  );

  const valueOf = (r: StationRanking) => (tab === 'reach' ? r.within30 : r.distortionIndex);
  const formatValue = (r: StationRanking) =>
    tab === 'reach' ? `${r.within30}駅` : r.distortionIndex.toFixed(2);

  const sorted = useMemo(() => {
    if (!ranking) return [];
    return [...ranking].sort((a, b) => valueOf(b) - valueOf(a));
  }, [ranking, tab]);

  const centerRank = useMemo(() => {
    const idx = sorted.findIndex((r) => r.stationId === centerStationId);
    return idx === -1 ? null : idx + 1;
  }, [sorted, centerStationId]);

  const commit = (stationId: number) => {
    onSelect(stationId);
    onClose();
  };

  const row = (r: StationRanking, rank: number) => {
    const isCenter = r.stationId === centerStationId;
    const s = network.station(r.stationId);
    return (
      <li key={r.stationId}>
        <button
          type="button"
          class={isCenter ? 'ranking__row ranking__row--current' : 'ranking__row'}
          onClick={() => commit(r.stationId)}
        >
          <span class="ranking__rank">{rank}</span>
          <span class="ranking__name">{s.name}</span>
          <span class="ranking__value">{formatValue(r)}</span>
        </button>
      </li>
    );
  };

  const bestCount = Math.min(EDGE_COUNT, sorted.length);
  const worstStart = Math.max(bestCount, sorted.length - EDGE_COUNT);

  return (
    <dialog class="dialog" ref={ref} onClose={onClose} aria-labelledby="ranking-title">
      <div class="ranking__titleRow">
        <h2 class="dialog__title" id="ranking-title">
          ランキング
        </h2>
        <a class="ranking__defLink" href={DEFINITION_URL} target="_blank" rel="noopener noreferrer">
          指標の定義 ↗
        </a>
      </div>

      <div class="ranking__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reach'}
          class={tab === 'reach' ? 'ranking__tab ranking__tab--active' : 'ranking__tab'}
          onClick={() => setTab('reach')}
        >
          30分圏内 到達駅数
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'distortion'}
          class={tab === 'distortion' ? 'ranking__tab ranking__tab--active' : 'ranking__tab'}
          onClick={() => setTab('distortion')}
        >
          ゆがみ指数
        </button>
      </div>

      {tab === 'reach' ? (
        <p class="dialog__lead">
          その駅を中心にしたとき、30分以内に電車で行ける駅の数が多い順です。乗換の便がよい結節点ほど上位に来ます。
        </p>
      ) : (
        <p class="dialog__lead">
          その駅を中心に見たときの実効速度（直線距離÷所要時間）が、方向によってどれだけばらつくかを表す指数です。
          値が大きいほど「近いのに時間がかかる方向」と「遠いのに時間が短い方向」の差が大きく、
          地理的な地図の直感が利きにくい駅ということになります。
        </p>
      )}

      <label class="ranking__allToggle">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.currentTarget.checked)}
        />
        全駅表示
      </label>

      {centerRank !== null && (
        <p class="ranking__current">
          現在の中心駅：<strong>{network.station(centerStationId).name}</strong>{' '}
          {sorted[centerRank - 1] ? formatValue(sorted[centerRank - 1]!) : ''}
          （{centerRank}位 / {sorted.length}駅中）
        </p>
      )}

      {showAll ? (
        <ol class="ranking__list ranking__list--full">{sorted.map((r, i) => row(r, i + 1))}</ol>
      ) : (
        <>
          <h3 class="ranking__sectionTitle">上位{bestCount}</h3>
          <ol class="ranking__list">{sorted.slice(0, bestCount).map((r, i) => row(r, i + 1))}</ol>
          <h3 class="ranking__sectionTitle">下位{sorted.length - worstStart}</h3>
          <ol class="ranking__list">
            {sorted.slice(worstStart).map((r, i) => row(r, worstStart + i + 1))}
          </ol>
        </>
      )}

      <div class="dialog__actions">
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
