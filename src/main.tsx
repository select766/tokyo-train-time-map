import { render } from 'preact';
import { loadNetwork } from './data/network.ts';
import { App } from './ui/App.tsx';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app が見つかりません');

loadNetwork(`${import.meta.env.BASE_URL}data/network.json`)
  .then((network) => render(<App network={network} />, root))
  .catch((error: unknown) => {
    root.textContent = `データの読み込みに失敗しました: ${String(error)}`;
  });
