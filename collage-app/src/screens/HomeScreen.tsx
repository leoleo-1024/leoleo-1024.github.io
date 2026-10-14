import { ImageIcon, MoreHorizontal, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog, Header, IconButton } from '../components/ui';
import { navigate } from '../lib/router';
import { createProject } from '../model/project';
import { projectsRepo, requestPersistence, StorageError, type ProjectRecord } from '../storage/db';
import { toast } from '../state/toast';

function formatDate(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function useObjectUrls(projects: ProjectRecord[]) {
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) if (p.thumbnail) m.set(p.id, URL.createObjectURL(p.thumbnail));
    return m;
  }, [projects]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

export function HomeScreen() {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [menuFor, setMenuFor] = useState<ProjectRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = useObjectUrls(projects ?? []);

  const reload = useCallback(() => {
    projectsRepo
      .list()
      .then((list) => {
        setProjects(list);
        setError(null);
      })
      .catch((e: unknown) => {
        setProjects([]);
        setError(e instanceof StorageError ? e.message : 'プロジェクトを読み込めませんでした。');
      });
  }, []);

  useEffect(reload, [reload]);

  const create = async () => {
    const p = createProject();
    try {
      await projectsRepo.put(p);
      void requestPersistence();
      navigate({ name: 'images', projectId: p.id });
    } catch (e) {
      toast.error(e instanceof StorageError ? e.message : 'プロジェクトを作成できませんでした。');
    }
  };

  const rename = async (p: ProjectRecord) => {
    setMenuFor(null);
    const name = window.prompt('プロジェクト名', p.name)?.trim();
    if (!name || name === p.name) return;
    try {
      await projectsRepo.rename(p.id, name);
      reload();
    } catch (e) {
      toast.error(e instanceof StorageError ? e.message : '名前を変更できませんでした。');
    }
  };

  const remove = async (p: ProjectRecord) => {
    setConfirmDelete(null);
    try {
      await projectsRepo.remove(p.id);
      toast.info('プロジェクトを削除しました');
      reload();
    } catch (e) {
      toast.error(e instanceof StorageError ? e.message : '削除できませんでした。');
    }
  };

  const latest = projects?.[0];

  return (
    <div className="flex h-full flex-col">
      <Header
        title="壁紙コラージュ"
        right={
          <IconButton label="設定" onClick={() => navigate({ name: 'settings' })}>
            <Settings size={22} />
          </IconButton>
        }
      />
      <main className="pb-safe flex-1 overflow-y-auto px-4">
        <button
          onClick={create}
          className="mt-4 flex w-full items-center gap-4 rounded-2xl bg-accent p-4 text-left active:opacity-80"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
            <Plus size={28} />
          </span>
          <span>
            <span className="block text-[17px] font-semibold">新しい壁紙を作成</span>
            <span className="block text-[13px] text-white/80">写真を選んでコラージュ</span>
          </span>
        </button>

        {latest && (
          <button
            onClick={() => navigate({ name: 'editor', projectId: latest.id })}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left active:opacity-80"
          >
            <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
              {urls.get(latest.id) ? <img src={urls.get(latest.id)} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={20} className="text-muted" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">前回の編集を再開</span>
              <span className="block truncate text-[13px] text-muted">{latest.name}</span>
            </span>
          </button>
        )}

        <h2 className="mt-6 mb-2 text-[13px] font-medium text-muted">保存済みプロジェクト</h2>
        {error && <p className="rounded-xl bg-surface p-4 text-[14px] text-[#ffb4ab]">{error}</p>}
        {projects && projects.length === 0 && !error && (
          <p className="rounded-xl bg-surface p-6 text-center text-[14px] text-muted">まだプロジェクトはありません</p>
        )}
        <ul className="grid grid-cols-2 gap-3 pb-6 sm:grid-cols-3 md:grid-cols-4">
          {projects?.map((p) => (
            <li key={p.id} className="relative">
              <button
                onClick={() => navigate({ name: 'editor', projectId: p.id })}
                className="block w-full text-left active:opacity-80"
                aria-label={`${p.name}を開く`}
              >
                <div
                  className="flex w-full items-center justify-center overflow-hidden rounded-xl bg-surface"
                  style={{ aspectRatio: `${p.canvasWidth} / ${p.canvasHeight}` }}
                >
                  {urls.get(p.id) ? (
                    <img src={urls.get(p.id)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="text-surface-3" size={32} />
                  )}
                </div>
                <div className="mt-1.5 truncate pr-8 text-[14px] font-medium">{p.name}</div>
                <div className="text-[12px] text-muted">
                  {formatDate(p.updatedAt)}・{p.imageLayers.length}枚
                </div>
              </button>
              <IconButton
                label={`${p.name}のメニュー`}
                className="absolute right-0 bottom-0"
                onClick={() => setMenuFor(p)}
              >
                <MoreHorizontal size={20} />
              </IconButton>
            </li>
          ))}
        </ul>
      </main>

      {menuFor && (
        <div className="fixed inset-0 z-50 flex animate-fade items-end bg-black/50" onClick={() => setMenuFor(null)}>
          <div className="pb-safe w-full animate-sheet rounded-t-2xl bg-surface-2 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
            <p className="truncate px-2 pb-2 text-center text-[13px] text-muted">{menuFor.name}</p>
            <button className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-[16px] active:bg-surface-3" onClick={() => rename(menuFor)}>
              <Pencil size={20} /> 名前を変更
            </button>
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-[16px] text-danger active:bg-surface-3"
              onClick={() => {
                setConfirmDelete(menuFor);
                setMenuFor(null);
              }}
            >
              <Trash2 size={20} /> 削除
            </button>
            <button className="mt-1 mb-3 min-h-12 w-full rounded-xl bg-surface-3 text-[16px] font-semibold" onClick={() => setMenuFor(null)}>
              キャンセル
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        title="プロジェクトを削除しますか？"
        message="追加した画像も含めて削除され、元に戻せません。iPhoneの写真ライブラリには影響しません。"
        confirmLabel="削除"
        danger
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
