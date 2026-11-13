import { useEffect, useState } from 'react';
import type { EditorController } from '../editor/EditorController';
import { editedFileName, type ExportFormat } from '../lib/export';
import { canShareFile, downloadBlob, shareFile } from '../lib/share';
import { showToast, store, useStore } from '../state/store';
import { Icon } from './icons';

/** JPEG の品質（0〜1） */
export const JPEG_QUALITY = 0.92;

interface Result {
  file: File;
  url: string;
  width: number;
  height: number;
}

function fmtBytes(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function ExportSheet({ editor, onClose }: { editor: EditorController; onClose: () => void }) {
  const info = useStore((s) => s.image)!;
  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const run = async () => {
    setError(null);
    store.set({ busy: { message: '元の解像度で書き出しています…', progress: 0 } });
    try {
      const r = await editor.export({ format, quality: JPEG_QUALITY, hasAlpha: info.hasAlpha }, (p) =>
        store.set({ busy: { message: '元の解像度で書き出しています…', progress: p } }),
      );
      const name = editedFileName(info.name, format);
      const file = new File([r.blob], name, { type: r.blob.type || (format === 'png' ? 'image/png' : 'image/jpeg') });
      setResult({ file, url: URL.createObjectURL(file), width: r.width, height: r.height });
    } catch (e) {
      console.error(e);
      setError(
        e instanceof RangeError
          ? 'メモリが不足したため書き出せませんでした。他のアプリやタブを閉じてから、もう一度お試しください。編集内容はそのまま残っています。'
          : '書き出しに失敗しました。もう一度お試しください。編集内容はそのまま残っています。',
      );
    } finally {
      store.set({ busy: null });
    }
  };

  const share = async () => {
    if (!result) return;
    const r = await shareFile(result.file);
    if (r.outcome === 'shared') {
      editor.markSaved();
      showToast('共有シートでの操作が完了しました。「画像を保存」を選んだ場合は写真アプリに保存されています。');
    } else if (r.outcome === 'cancelled') {
      showToast('共有をキャンセルしました。');
    } else if (r.outcome === 'unsupported') {
      showToast('この環境では共有シートを使えません。「ダウンロード」か、画像の長押しで保存してください。', 'error');
    } else {
      showToast(`共有できませんでした（${r.message ?? '不明なエラー'}）。「ダウンロード」か、画像の長押しで保存してください。`, 'error');
    }
  };

  const download = () => {
    if (!result) return;
    downloadBlob(result.file, result.file.name);
    editor.markSaved();
    showToast('ダウンロードを開始しました。');
  };

  const shareable = result ? canShareFile(result.file) : false;

  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-label="保存・共有" data-testid="export-sheet">
        <div className="sheet-head">
          <h2>保存・共有</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる" data-testid="export-close">
            <Icon.close />
          </button>
        </div>
        <div className="slider-row">
          <span className="slider-label">形式</span>
          <div className="segmented" role="radiogroup" aria-label="形式">
            {(['jpeg', 'png'] as const).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={format === f}
                className={format === f ? 'is-on' : ''}
                data-testid={`format-${f}`}
                onClick={() => {
                  if (f === format) return;
                  setFormat(f);
                  setResult(null);
                }}
              >
                {f === 'jpeg' ? 'JPEG' : 'PNG'}
              </button>
            ))}
          </div>
        </div>
        <p className="sheet-note">
          {info.width.toLocaleString()} × {info.height.toLocaleString()} px
          {info.reducedFrom ? '（縮小して開いたサイズ）' : '（元の解像度）'}
          {format === 'jpeg' && info.hasAlpha && <><br />この写真には透明な部分があります。JPEG では白になります。透明を残すには PNG を選んでください。</>}
          <br />
          位置情報などのメタデータや編集前の画素は保存されません。
        </p>
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
        {!result ? (
          <button className="btn btn-primary btn-wide" onClick={run} data-testid="export-run">
            書き出す
          </button>
        ) : (
          <>
            <div className="result">
              <img src={result.url} alt="書き出した画像" data-testid="export-preview" />
              <div className="result-meta" data-testid="export-meta">
                {result.file.name}
                <br />
                {result.width} × {result.height} px・{fmtBytes(result.file.size)}
              </div>
            </div>
            <div className="sheet-actions">
              {shareable && (
                <button className="btn btn-primary btn-wide" onClick={share} data-testid="export-share">
                  <Icon.share />
                  共有・写真に保存
                </button>
              )}
              <button className={`btn btn-wide ${shareable ? '' : 'btn-primary'}`} onClick={download} data-testid="export-download">
                <Icon.download />
                ダウンロード
              </button>
            </div>
            <p className="sheet-note small">共有シートで「画像を保存」を選ぶと写真アプリに保存されます。上の画像を長押しして保存することもできます。</p>
          </>
        )}
      </section>
    </div>
  );
}
