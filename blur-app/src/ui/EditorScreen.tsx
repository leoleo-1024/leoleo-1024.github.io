import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorController } from '../editor/EditorController';
import { showToast, store, useStore } from '../state/store';
import { BottomPanel } from './BottomPanel';
import { ExportSheet } from './ExportSheet';
import { Icon } from './icons';

function CompareButton() {
  const comparing = useStore((s) => s.comparing);
  const set = (v: boolean) => store.get().comparing !== v && store.set({ comparing: v });
  return (
    <button
      className={`icon-btn ${comparing ? 'is-on' : ''}`}
      aria-label="元画像と比較（長押し）"
      title="長押しで元画像を表示"
      data-testid="compare"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && set(true)}
      onKeyUp={() => set(false)}
      onBlur={() => set(false)}
    >
      <Icon.compare />
      <span className="icon-label">比較</span>
    </button>
  );
}

export function EditorScreen({ editor, onOpen }: { editor: EditorController; onOpen: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const display = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const zoom = useStore((s) => s.zoom);
  const rendering = useStore((s) => s.rendering);
  const comparing = useStore((s) => s.comparing);
  const pending = useStore((s) => s.pending);
  const [exportOpen, setExportOpen] = useState(false);

  useLayoutEffect(() => {
    editor.attach(stage.current!, display.current!, overlay.current!);
    return () => editor.detach();
  }, [editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        editor.redo();
      } else if (e.key === 'Enter' && editor.hasPending()) {
        editor.applyPending();
      } else if (e.key === 'Escape' && editor.hasPending()) {
        editor.cancelPending();
      } else if (e.key === '0' && mod) {
        e.preventDefault();
        editor.resetView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const openExport = () => {
    if (editor.hasPending()) {
      showToast('選択範囲を「適用」または「キャンセル」してから保存してください。');
      return;
    }
    setExportOpen(true);
  };

  return (
    <div className="editor">
      <header className="topbar">
        <button className="icon-btn" onClick={onOpen} aria-label="新しい写真を開く" data-testid="new-photo">
          <Icon.photo />
          <span className="icon-label">写真</span>
        </button>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => editor.undo()} disabled={!canUndo} aria-label="元に戻す" data-testid="undo">
          <Icon.undo />
          <span className="icon-label">戻す</span>
        </button>
        <button className="icon-btn" onClick={() => editor.redo()} disabled={!canRedo} aria-label="やり直す" data-testid="redo">
          <Icon.redo />
          <span className="icon-label">やり直し</span>
        </button>
        <CompareButton />
        <div className="spacer" />
        <button className="save-btn" onClick={openExport} data-testid="save">
          <Icon.share />
          保存
        </button>
      </header>
      <div className="stage" ref={stage} data-testid="stage">
        <canvas ref={display} className="layer" />
        <canvas ref={overlay} className="layer" />
        {comparing && <div className="badge badge-top">元画像</div>}
        {rendering && <div className="render-indicator" aria-label="処理中" />}
        {pending && !comparing && (
          <div className="apply-bar">
            <button className="btn" onClick={() => editor.cancelPending()} data-testid="cancel-selection">
              <Icon.close />
              キャンセル
            </button>
            <button className="btn btn-primary" onClick={() => editor.applyPending()} data-testid="apply-selection">
              <Icon.check />
              適用
            </button>
          </div>
        )}
        {zoom > 1.01 && (
          <button className="fit-btn" onClick={() => editor.resetView()} data-testid="fit">
            <Icon.fit />
            {zoom.toFixed(1)}×
          </button>
        )}
      </div>
      <BottomPanel />
      {exportOpen && <ExportSheet editor={editor} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
