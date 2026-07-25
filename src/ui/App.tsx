import { useEffect, useRef, useState } from 'preact/hooks';
import type { Network } from '../data/network.ts';
import { MapView } from '../render/mapView.ts';
import { reachStats, type ReachStats } from '../layout/polar.ts';
import { StationSearch } from './StationSearch.tsx';
import { StatsPanel } from './StatsPanel.tsx';
import { ExtraLinesDialog } from './ExtraLinesDialog.tsx';
import { DistortionLegend } from './DistortionLegend.tsx';
import type { ColorScheme } from '../render/distortionPaint.ts';
import { readUrlState, writeUrlState } from '../urlState.ts';

const DEFAULT_PX_PER_MINUTE = 20;
const DEFAULT_FONT_SIZE = 14;

export function App({ network }: { network: Network }) {
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<MapView>(null);
  const [centerId, setCenterId] = useState(() => initialCenter(network));
  const [stats, setStats] = useState<ReachStats>(() =>
    reachStats(network.travelMinutesFrom(initialCenter(network))),
  );
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeGroups, setActiveGroups] = useState<ReadonlySet<string>>(() => network.groups);
  // おまけの駅は無効なときリストに出さない
  const [searchable, setSearchable] = useState(() => network.activeStations());
  const [showField, setShowField] = useState(() => readUrlState().field ?? false);
  const [scheme, setScheme] = useState<ColorScheme>(prefersDark);

  // 端末の明暗設定に追従する。地の色が変わると読める配色も変わる
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next: ColorScheme = mq.matches ? 'dark' : 'light';
      setScheme(next);
      view.current?.setColorScheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!holder.current) return;
    const initial = initialCenter(network);
    const map = new MapView(holder.current, {
      network,
      centerStationId: initial,
      pxPerMinute: readUrlState().scale ?? DEFAULT_PX_PER_MINUTE,
      fontSize: DEFAULT_FONT_SIZE,
      onCenterChange: (id) => {
        setCenterId(id);
        setStats(reachStats(map.travelMinutes));
        setActiveGroups(new Set(network.groups));
        setSearchable(network.activeStations());
        writeUrlState({
          center: network.station(id).name,
          scale: map.scale,
          extra: [...network.groups],
          field: map.fieldVisible,
        });
      },
      onHover: setHovered,
    });
    view.current = map;
    map.setColorScheme(prefersDark());
    map.centerOnViewport();
    if (readUrlState().field) map.setFieldVisible(true);

    const onResize = () => map.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      map.destroy();
      view.current = null;
    };
  }, [network]);

  const centerName = network.station(centerId).name;
  const hoveredStation = hovered !== null ? network.station(hovered) : null;
  const hoveredMinutes =
    hovered !== null && view.current ? view.current.travelMinutes[hovered] : undefined;

  return (
    <>
      <header class="header">
        <h1 class="header__title">Tokyo Train Time Map</h1>
        <p class="header__lead">
          中心駅からの電車での所要時間を、地図上の距離で表しています。円1個が10分。
          駅をクリックするとそこが中心になります。
        </p>
      </header>

      <div class="toolbar">
        <StationSearch
          stations={searchable}
          currentName={centerName}
          onSelect={(id) => view.current?.setCenter(id)}
        />
        <div class="toolbar__group" role="group" aria-label="表示倍率">
          <button
            type="button"
            onClick={() => view.current?.setScale(view.current.scale * 1.5)}
            aria-label="拡大"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => view.current?.setScale(view.current.scale / 1.5)}
            aria-label="縮小"
          >
            －
          </button>
        </div>
        <div class="toolbar__group">
          <button type="button" onClick={() => view.current?.fitToContent()}>
            全体表示
          </button>
        </div>
        <div class="toolbar__group">
          <button
            type="button"
            class={showField ? 'button--on' : undefined}
            aria-pressed={showField}
            onClick={() => {
              const next = !showField;
              setShowField(next);
              view.current?.setFieldVisible(next);
              writeUrlState({ field: next });
            }}
          >
            ゆがみを色で表示
          </button>
        </div>
        <div class="toolbar__group">
          <button
            type="button"
            class={activeGroups.size > 0 ? 'button--on' : undefined}
            onClick={() => setDialogOpen(true)}
          >
            おまけモード
            {activeGroups.size > 0 && <span class="badge">{activeGroups.size}</span>}
          </button>
        </div>
        <div class="toolbar__group" role="group" aria-label="文字サイズ">
          <button
            type="button"
            onClick={() => {
              const next = Math.min(fontSize + 2, 28);
              setFontSize(next);
              view.current?.setFontSize(next);
            }}
            aria-label="文字を大きく"
          >
            大
          </button>
          <button
            type="button"
            onClick={() => {
              const next = Math.max(fontSize - 2, 8);
              setFontSize(next);
              view.current?.setFontSize(next);
            }}
            aria-label="文字を小さく"
          >
            小
          </button>
        </div>
      </div>

      <div class="map-holder" ref={holder}>
        {showField && <DistortionLegend scheme={scheme} />}
        {hoveredStation && (
          <div class="tooltip" role="status">
            {hoveredStation.name}
            {hoveredMinutes !== undefined && Number.isFinite(hoveredMinutes)
              ? ` ${Math.round(hoveredMinutes)}分`
              : ''}
          </div>
        )}
      </div>

      <StatsPanel network={network} centerName={centerName} stats={stats} />

      <ExtraLinesDialog
        open={dialogOpen}
        groups={network.optionalGroups}
        lines={network.lines}
        active={activeGroups}
        onToggle={(groupId, enabled) => {
          const next = new Set(activeGroups);
          if (enabled) next.add(groupId);
          else next.delete(groupId);
          // 状態の正は Network 側。反映後に onCenterChange 経由で UI が追随する
          view.current?.setActiveGroups(next);
        }}
        onClose={() => setDialogOpen(false)}
      />

      <footer class="footer">
        <p class="footer__caveat">
          平面に駅を並べる都合上、<strong>中心駅以外の駅どうしの所要時間は正しく表現されません</strong>。
          乗換・徒歩連絡は一律{network.data.meta.transferMinutes}分として計算しています。
        </p>
        <p>
          所要時間データ: {network.data.meta.timetableBasis} /{' '}
          <a href="https://github.com/select766/tokyo-train-time-map">GitHub</a>
        </p>
      </footer>
    </>
  );
}

function prefersDark(): ColorScheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialCenter(network: Network): number {
  const name = readUrlState().center;
  if (name) {
    const found = network.findByName(name);
    // おまけを無効にしたまま未開業駅の URL を開く場合があるので存在を確かめる
    if (found && network.isStationActive(found.id)) return found.id;
  }
  return network.findByName('東京')?.id ?? 0;
}
