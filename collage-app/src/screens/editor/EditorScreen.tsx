import { Eye, ChevronLeft, ImagePlus, LayoutGrid, Layers, Paintbrush, Redo2, Ruler, Share, SlidersHorizontal, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CanvasStage, type StageHandle } from '../../components/CanvasStage';
import { Header, IconButton, ProgressOverlay, ToolButton, cx } from '../../components/ui';
import { navigate } from '../../lib/router';
import { useEditor } from '../../state/editorStore';
import { ArrangePanel, BackgroundPanel, EditPanel, ImagesPanel, LayoutPanel, SizePanel, type PanelId } from './Panels';

declare global {
  interface Window {
    __collageStage?: StageHandle;
  }
}

const TOOLS: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'images', label: '追加', icon: <ImagePlus size={22} /> },
  { id: 'layout', label: 'レイアウト', icon: <LayoutGrid size={22} /> },
  { id: 'background', label: '背景', icon: <Paintbrush size={22} /> },
  { id: 'edit', label: '編集', icon: <SlidersHorizontal size={22} /> },
  { id: 'arrange', label: '重なり', icon: <Layers size={22} /> },
  { id: 'size', label: 'サイズ', icon: <Ruler size={22} /> },
];

const PANEL_TITLE: Record<PanelId, string> = {
  images: '画像',
  layout: 'レイアウト',
  background: '背景',
  edit: '画像編集',
  arrange: '重なり順',
  size: '壁紙サイズ',
};

function SaveIndicator() {
  const status = useEditor((s) => s.saveStatus);
  const label = status === 'error' ? '保存失敗' : status === 'saving' || status === 'pending' ? '保存中…' : status === 'saved' ? '保存済み' : '';
  return <span className={cx('block text-[11px] font-normal', status === 'error' ? 'text-danger' : 'text-muted')}>{label}</span>;
}

export function EditorScreen({ projectId }: { projectId: string }) {
  const project = useEditor((s) => s.project)!;
  const doc = useEditor((s) => s.doc)!;
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const selectedId = useEditor((s) => s.selectedId);
  const importing = useEditor((s) => s.importing);
  const { undo, redo, rename, deleteLayer, setCropMode } = useEditor.getState();
  const [panel, setPanel] = useState<PanelId | null>(null);

  // 画像を選択したら編集パネルを開く（パネルが閉じている場合のみ）。
  // 操作中にキャンバスの表示サイズが変わらないよう、指を離してから開く
  const gesturing = useEditor((s) => s.gestureBefore !== null);
  useEffect(() => {
    if (selectedId && !gesturing && panel === null) setPanel('edit');
  }, [selectedId, gesturing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (panel !== 'edit') setCropMode(false);
  }, [panel, setCropMode]);

  // キーボード操作（PC）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) {
        e.preventDefault();
        deleteLayer(s.selectedId);
      } else if (e.key === 'Escape') {
        s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteLayer]);

  const onRename = () => {
    const name = window.prompt('プロジェクト名', project.name)?.trim();
    if (name) rename(name);
  };

  const empty = doc.imageLayers.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        left={
          <>
            <IconButton label="戻る" onClick={() => navigate({ name: 'home' })}>
              <ChevronLeft size={26} />
            </IconButton>
            <IconButton label="元に戻す" disabled={!canUndo} onClick={undo}>
              <Undo2 size={22} />
            </IconButton>
            <IconButton label="やり直し" disabled={!canRedo} onClick={redo}>
              <Redo2 size={22} />
            </IconButton>
          </>
        }
        title={
          <button onClick={onRename} className="max-w-[40vw] truncate text-[15px] font-semibold" aria-label="プロジェクト名を変更">
            {project.name}
            <SaveIndicator />
          </button>
        }
        right={
          <>
            <IconButton label="プレビュー" onClick={() => navigate({ name: 'preview', projectId })}>
              <Eye size={22} />
            </IconButton>
            <IconButton label="保存・書き出し" className="text-accent" onClick={() => navigate({ name: 'export', projectId })}>
              <Share size={22} />
            </IconButton>
          </>
        }
      />

      <div className="relative min-h-0 flex-1 bg-[#0c0c0d]">
        <CanvasStage onReady={import.meta.env.VITE_E2E === '1' ? (h) => (window.__collageStage = h) : undefined} />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-xl bg-black/60 px-4 py-2 text-[14px] text-white/80">下の「追加」から写真を追加</p>
          </div>
        )}
      </div>

      {panel && (
        <section className="max-h-[38vh] shrink-0 animate-sheet overflow-y-auto rounded-t-2xl bg-surface-2/95 px-4 pt-2 pb-3 backdrop-blur-xl" aria-label={PANEL_TITLE[panel]}>
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-white/25" />
          {panel === 'images' && <ImagesPanel />}
          {panel === 'layout' && <LayoutPanel />}
          {panel === 'background' && <BackgroundPanel />}
          {panel === 'edit' && <EditPanel />}
          {panel === 'arrange' && <ArrangePanel />}
          {panel === 'size' && <SizePanel />}
        </section>
      )}

      <nav className="pb-safe shrink-0 border-t border-white/10 bg-black">
        <div className="flex px-1 pt-1">
          {TOOLS.map((t) => (
            <ToolButton key={t.id} icon={t.icon} label={t.label} active={panel === t.id} aria-pressed={panel === t.id} onClick={() => setPanel(panel === t.id ? null : t.id)} />
          ))}
        </div>
      </nav>
      {importing && <ProgressOverlay label="画像を読み込み中…" done={importing.done} total={importing.total} />}
    </div>
  );
}
