import { CheckCircle2, ChevronLeft, Download, Share } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Header, IconButton, ProgressOverlay, Segmented } from '../components/ui';
import { navigate } from '../lib/router';
import { presetLabel } from '../model/presets';
import { canShareFile, downloadFile, exportProject, shareFile, type ExportFormat, type ExportResult } from '../render/export';
import { settingsRepo } from '../storage/db';
import { useEditor } from '../state/editorStore';
import { toast } from '../state/toast';

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function ExportScreen({ projectId }: { projectId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const project = useEditor((s) => s.project)!;
  const [format, setFormat] = useState<ExportFormat>('png');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const url = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  useEffect(() => {
    settingsRepo.get<ExportFormat>('exportFormat', 'png').then(setFormat);
  }, []);

  // 編集内容・形式が変わったら書き出し結果を破棄
  useEffect(() => {
    setResult(null);
    setSavedMsg(null);
  }, [doc, format]);

  const transparentJpeg = format === 'jpeg' && doc.background.type === 'transparent';

  const run = async () => {
    setError(null);
    setSavedMsg(null);
    setProgress({ done: 0, total: doc.imageLayers.length + 1 });
    try {
      await useEditor.getState().flushSave();
      const r = await exportProject(doc, project.name, format, (done, total) => setProgress({ done, total }));
      setResult(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`書き出しに失敗しました：${msg}。画像の枚数を減らすか、他のアプリを終了してから再度お試しください。`);
    } finally {
      setProgress(null);
    }
  };

  // 共有シートはタップ直後に同期的に呼ぶ必要があるため、書き出し済みのファイルを使う
  const share = async () => {
    if (!result) return;
    const outcome = await shareFile(result.file);
    if (outcome === 'shared') setSavedMsg('共有シートを閉じました。「画像を保存」を選んだ場合は写真アプリに保存されています。');
    else if (outcome === 'unsupported') {
      downloadFile(result.file);
      setSavedMsg('このブラウザは共有に対応していないため、ダウンロードしました。');
    } else if (outcome === 'failed') {
      toast.error('共有シートを開けませんでした。下の画像を長押しして「"写真"に保存」を選ぶか、ダウンロードをお試しください。');
    }
  };

  const download = () => {
    if (!result) return;
    downloadFile(result.file);
    setSavedMsg(isIOS() ? 'ダウンロードしました。「ファイル」アプリの「ダウンロード」フォルダに保存されます。' : 'ダウンロードしました。');
  };

  const shareSupported = result ? canShareFile(result.file) : true;

  return (
    <div className="flex h-full flex-col">
      <Header
        left={
          <IconButton label="編集に戻る" onClick={() => navigate({ name: 'editor', projectId })}>
            <ChevronLeft size={26} />
          </IconButton>
        }
        title="保存・書き出し"
      />
      <main className="pb-safe flex-1 overflow-y-auto px-4">
        <section className="mt-3 space-y-3 rounded-2xl bg-surface p-4">
          <div>
            <p className="mb-1.5 text-[13px] text-muted">画像形式</p>
            <Segmented<ExportFormat>
              value={format}
              onChange={(f) => {
                setFormat(f);
                void settingsRepo.set('exportFormat', f).catch(() => {});
              }}
              options={[
                { value: 'png', label: 'PNG（高画質）' },
                { value: 'jpeg', label: 'JPEG（軽量）' },
              ]}
            />
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-muted">出力解像度</span>
            <span className="tabular-nums" data-testid="output-size">
              {doc.canvasWidth} × {doc.canvasHeight} px
            </span>
          </div>
          <p className="text-[12px] text-muted">{presetLabel(doc.presetId, doc.canvasWidth, doc.canvasHeight)}</p>
          {transparentJpeg && <p className="text-[12px] text-[#ffd60a]">JPEGは透明を扱えないため、背景は黒になります。透明のまま保存するにはPNGを選んでください。</p>}
          <Button variant="primary" className="w-full" onClick={run} disabled={!!progress}>
            {result ? 'もう一度書き出す' : '画像を書き出す'}
          </Button>
        </section>

        {error && (
          <p className="mt-3 rounded-xl bg-[#3a1512] p-3 text-[13px] text-[#ffb4ab]" role="alert">
            {error}
          </p>
        )}

        {result && url && (
          <section className="mt-4 animate-fade" data-testid="export-result">
            <div className="flex items-center gap-2 text-[14px] text-[#a6f4b6]">
              <CheckCircle2 size={18} />
              書き出し完了（{result.width} × {result.height} px・{formatBytes(result.blob.size)}）
            </div>
            <div className="mt-3 flex gap-3">
              <Button variant="primary" className="flex-1" onClick={share} data-testid="share-button">
                <Share size={20} /> {shareSupported ? '写真に保存・共有' : '保存'}
              </Button>
              <Button className="flex-1" onClick={download} data-testid="download-button">
                <Download size={20} /> ダウンロード
              </Button>
            </div>
            {savedMsg && <p className="mt-2 text-[13px] text-white/80">{savedMsg}</p>}
            <div className="mt-4 flex justify-center">
              <img src={url} alt="書き出した壁紙" className="max-h-[60vh] w-auto rounded-xl border border-white/10" data-testid="export-image" />
            </div>
            <div className="mt-3 rounded-xl bg-surface p-3 text-[12px] leading-relaxed text-muted">
              <p className="font-semibold text-white/80">iPhoneで写真に保存するには</p>
              <ol className="mt-1 list-decimal pl-5">
                <li>「写真に保存・共有」をタップし、共有シートで「画像を保存」を選びます。</li>
                <li>共有シートが開かない場合は、上の画像を長押しして「"写真"に保存」を選びます。</li>
                <li>写真アプリで画像を開き、共有ボタン →「壁紙に設定」で壁紙にできます。</li>
              </ol>
            </div>
          </section>
        )}
        <div className="h-6" />
      </main>
      {progress && <ProgressOverlay label="高解像度で書き出し中…" done={progress.done} total={progress.total} />}
    </div>
  );
}
