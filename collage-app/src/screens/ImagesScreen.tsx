import { ChevronLeft, ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';
import { FilePicker, type FilePickerHandle } from '../components/FilePicker';
import { Button, Header, IconButton, ProgressOverlay } from '../components/ui';
import { navigate } from '../lib/router';
import { useEditor } from '../state/editorStore';
import { thumbUrl } from '../state/imageCache';

/** 画像選択画面：写真ライブラリ・ファイルから追加し、選択内容を確認する */
export function ImagesScreen({ projectId }: { projectId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const importing = useEditor((s) => s.importing);
  const addFiles = useEditor((s) => s.addFiles);
  const removeAsset = useEditor((s) => s.removeAsset);
  const picker = useRef<FilePickerHandle>(null);

  const ids = doc.assetIds.filter((id) => assets[id]);
  const countFor = (id: string) => doc.imageLayers.filter((l) => l.assetId === id).length;

  return (
    <div className="flex h-full flex-col">
      <Header
        left={
          <IconButton label="戻る" onClick={() => navigate({ name: 'home' })}>
            <ChevronLeft size={26} />
          </IconButton>
        }
        title="画像を選択"
        right={
          <Button variant="ghost" disabled={!ids.length} onClick={() => navigate({ name: 'editor', projectId })}>
            次へ
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto px-4 pb-4">
        <p className="mt-3 text-[13px] text-muted" data-testid="selected-count">
          選択中：{ids.length}枚
        </p>
        {ids.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center text-muted">
            <ImagePlus size={48} strokeWidth={1.4} />
            <p className="text-[15px]">壁紙に使う写真を追加してください</p>
            <p className="text-[12px]">複数枚まとめて選べます。写真はこの端末内だけで処理され、外部に送信されません。</p>
          </div>
        )}
        <ul className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {ids.map((id, i) => (
            <li key={id} className="relative aspect-square overflow-hidden rounded-lg bg-surface">
              <img src={thumbUrl(assets[id])} alt={assets[id].name} className="h-full w-full object-cover" />
              <span className="absolute top-1 left-1 rounded-full bg-black/60 px-1.5 text-[11px] tabular-nums">{i + 1}</span>
              {countFor(id) > 1 && (
                <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 text-[11px]">×{countFor(id)}</span>
              )}
              <button
                aria-label={`${assets[id].name}を選択解除`}
                className="absolute top-0 right-0 flex h-11 w-11 items-start justify-end p-1"
                onClick={() => removeAsset(id)}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70">
                  <X size={14} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
      <footer className="pb-safe shrink-0 border-t border-white/10 bg-black px-4 pt-3">
        <div className="mb-3 flex gap-3">
          <Button className="flex-1" onClick={() => picker.current?.open()}>
            <ImagePlus size={20} />
            {ids.length ? '写真を追加' : '写真を選ぶ'}
          </Button>
          <Button variant="primary" className="flex-1" disabled={!ids.length} onClick={() => navigate({ name: 'editor', projectId })}>
            編集へ進む
          </Button>
        </div>
      </footer>
      <FilePicker ref={picker} onFiles={addFiles} />
      {importing && <ProgressOverlay label="画像を読み込み中…" done={importing.done} total={importing.total} />}
    </div>
  );
}
