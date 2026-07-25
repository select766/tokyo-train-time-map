import type { Network } from '../data/network.ts';
import type { ReachStats } from '../layout/polar.ts';

interface Props {
  network: Network;
  centerName: string;
  stats: ReachStats;
}

/**
 * 「東京の電車はどこへ行くにも30分」という元の問いに数字で答えるためのパネル。
 * 地図を眺めるだけでは分からない割合をここに出す。
 */
export function StatsPanel({ network, centerName, stats }: Props) {
  const within30 = stats.within.find((w) => w.minutes === 30);
  const pct30 = within30 ? Math.round((within30.count / stats.reachable) * 100) : 0;
  const farthest = stats.farthest ? network.station(stats.farthest.stationId) : null;

  return (
    <section class="stats" aria-label="到達時間の統計">
      <p class="stats__headline">
        <strong>{centerName}</strong> から30分以内に
        <strong class="stats__big">{within30?.count ?? 0}</strong>駅
        <span class="stats__sub">
          （対象 {stats.reachable} 駅中 {pct30}%）
        </span>
      </p>
      <dl class="stats__grid">
        {stats.within.map((w) => (
          <div class="stats__cell" key={w.minutes}>
            <dt>{w.minutes}分以内</dt>
            <dd>{w.count}</dd>
          </div>
        ))}
        <div class="stats__cell">
          <dt>所要時間の中央値</dt>
          <dd>{Number.isFinite(stats.median) ? `${stats.median.toFixed(0)}分` : '—'}</dd>
        </div>
        <div class="stats__cell">
          <dt>最も遠い駅</dt>
          <dd>
            {farthest && stats.farthest
              ? `${farthest.name} ${Math.round(stats.farthest.minutes)}分`
              : '—'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
