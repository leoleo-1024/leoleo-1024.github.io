import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { useEditor } from '../state/editorStore';
import { Button } from './ui';

/** ルートのプロジェクト ID に対応するプロジェクトを読み込む */
export function useProject(projectId: string): 'loading' | 'ready' | 'error' {
  const project = useEditor((s) => s.project);
  const open = useEditor((s) => s.openProject);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(project?.id === projectId ? 'ready' : 'loading');
  useEffect(() => {
    let alive = true;
    if (useEditor.getState().project?.id === projectId) {
      setState('ready');
      return;
    }
    setState('loading');
    open(projectId).then((ok) => alive && setState(ok ? 'ready' : 'error'));
    return () => {
      alive = false;
    };
  }, [projectId, open]);
  return project?.id === projectId && state !== 'error' ? 'ready' : state;
}

export function ProjectGate({ projectId, children }: { projectId: string; children: () => React.ReactNode }) {
  const state = useProject(projectId);
  const error = useEditor((s) => s.loadError);
  if (state === 'loading') {
    return <div className="flex h-full items-center justify-center text-muted">読み込み中…</div>;
  }
  if (state === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-[15px] text-white/80">{error ?? 'プロジェクトを開けませんでした。'}</p>
        <Button variant="primary" onClick={() => navigate({ name: 'home' })}>
          ホームへ戻る
        </Button>
      </div>
    );
  }
  return <>{children()}</>;
}
