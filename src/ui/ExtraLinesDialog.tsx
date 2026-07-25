import { useEffect, useRef } from 'preact/hooks';
import type { Line, OptionalGroup } from '../data/schema.ts';

interface Props {
  open: boolean;
  groups: readonly OptionalGroup[];
  lines: readonly Line[];
  active: ReadonlySet<string>;
  onToggle: (groupId: string, enabled: boolean) => void;
  onClose: () => void;
}

/**
 * おまけモードのモーダル。計画中・建設中の路線を地図に足すかどうかを選ぶ。
 *
 * 駅の位置も駅間所要時間も公表資料からのおおまかな値なので、
 * 「そのくらい近くなる」という目安であることをここで断っておく。
 */
export function ExtraLinesDialog({ open, groups, lines, active, onToggle, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog class="dialog" ref={ref} onClose={onClose} aria-labelledby="extra-title">
      <h2 class="dialog__title" id="extra-title">
        おまけモード
      </h2>
      <p class="dialog__lead">
        まだ開業していない計画中・建設中の路線を地図に足します。
        駅の位置も所要時間も公表資料からのおおよその値なので、
        <strong>実際に開業したらこのくらい近くなる、という目安</strong>として見てください。
      </p>

      <ul class="dialog__list">
        {groups.map((group) => {
          const groupLines = lines.filter((l) => l.group === group.id);
          return (
            <li class="dialog__item" key={group.id}>
              <label class="dialog__label">
                <input
                  type="checkbox"
                  checked={active.has(group.id)}
                  onChange={(e) => onToggle(group.id, e.currentTarget.checked)}
                />
                <span>
                  <span class="dialog__name">{group.name}</span>
                  <span class="dialog__desc">{group.description}</span>
                  <span class="dialog__lines">
                    {groupLines.map((l) => (
                      <span class="dialog__chip" key={l.id}>
                        <span class="dialog__swatch" style={{ background: l.color }} />
                        {l.name}（{l.company}）
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div class="dialog__actions">
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
