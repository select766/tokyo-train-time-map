import { render } from 'preact';
import { loadNetwork } from './data/network.ts';
import { App } from './ui/App.tsx';
import { readUrlState } from './urlState.ts';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app が見つかりません');

loadNetwork(`${import.meta.env.BASE_URL}data/network.json`)
  .then((network) => {
    // おまけモードの状態は URL で共有できるので、描画前に反映しておく
    network.setActiveGroups(readUrlState().extra ?? []);
    render(<App network={network} />, root);
  })
  .catch((error: unknown) => {
    root.textContent = `データの読み込みに失敗しました: ${String(error)}`;
  });
