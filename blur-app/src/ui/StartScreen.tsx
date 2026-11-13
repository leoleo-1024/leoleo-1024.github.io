import { Icon } from './icons';

export function StartScreen({ onOpen }: { onOpen: () => void }) {
  return (
    <main className="start">
      <div className="start-inner">
        <div className="start-logo" aria-hidden="true">
          <Icon.pixelate />
        </div>
        <h1>ぼかし・モザイク</h1>
        <p className="start-lead">写真の一部をなぞるだけで、ぼかし・モザイク・黒塗りなどをかけられます。</p>
        <button className="btn btn-primary btn-large" onClick={onOpen} data-testid="open-photo">
          <Icon.photo />
          写真を選択
        </button>
        <ul className="start-notes">
          <li>写真は端末の中だけで処理され、どこにも送信されません。</li>
          <li>文字や個人情報を確実に隠したいときは「黒塗り」を使ってください。ぼかし・モザイクなどは完全に隠す手段ではありません。</li>
        </ul>
      </div>
    </main>
  );
}
