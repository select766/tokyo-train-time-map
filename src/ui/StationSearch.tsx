import { useMemo, useRef, useState } from 'preact/hooks';
import type { Station } from '../data/schema.ts';

interface Props {
  stations: readonly Station[];
  currentName: string;
  onSelect: (stationId: number) => void;
}

const MAX_SUGGESTIONS = 8;

/** 駅名で中心駅を選ぶ。旧版はダブルクリックで探すしかなかった */
export function StationSearch({ stations, currentName, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<number>(0);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const starts: Station[] = [];
    const contains: Station[] = [];
    for (const s of stations) {
      if (s.name === q || s.name.startsWith(q)) starts.push(s);
      else if (s.name.includes(q)) contains.push(s);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [query, stations]);

  const commit = (station: Station | undefined) => {
    if (!station) return;
    onSelect(station.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div class="search">
      <label class="search__label" for="station-search">
        中心駅
      </label>
      <input
        id="station-search"
        class="search__input"
        type="search"
        autocomplete="off"
        placeholder={currentName}
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 候補のクリックが先に走るよう少し待つ
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit(matches[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul class="search__list" role="listbox">
          {matches.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                class={i === highlight ? 'search__item search__item--active' : 'search__item'}
                onMouseDown={() => {
                  clearTimeout(blurTimer.current);
                  commit(s);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
