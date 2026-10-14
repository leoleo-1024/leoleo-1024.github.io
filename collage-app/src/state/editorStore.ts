import { create } from 'zustand';
import { uid } from '../lib/id';
import { importImageFile, ImageImportError, yieldToUI } from '../lib/image';
import { applyLayout, initialFreePlacement, makeLayer, normalizeLayers, type AssetSizeMap } from '../model/layout';
import { docOf } from '../model/project';
import { recomputeCrop } from '../model/geometry';
import type { ImageAsset, ImageLayer, Project, ProjectDoc } from '../model/types';
import { assetsRepo, projectsRepo, StorageError, toStorageError, type ProjectRecord } from '../storage/db';
import { renderProject } from '../render/renderProject';
import { canvasToBlob } from '../lib/image';
import { emptyHistory, pushHistory, redoHistory, undoHistory, type History } from './history';
import { getPreview, getPreviewById, releaseAll, releaseAsset } from './imageCache';
import { toast } from './toast';

/** メモリ上に保持するアセット情報（元画像の Blob は保持しない） */
export interface AssetMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  previewBlob: Blob;
  thumbBlob: Blob;
}

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface EditorState {
  project: Project | null;
  doc: ProjectDoc | null;
  assets: Record<string, AssetMeta>;
  history: History<ProjectDoc>;
  selectedId: string | null;
  /** フリーモードで画像の表示範囲（トリミング）を調整中か */
  cropMode: boolean;
  gestureBefore: ProjectDoc | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  importing: { done: number; total: number } | null;
  loadError: string | null;

  openProject: (id: string) => Promise<boolean>;
  closeProject: () => Promise<void>;
  rename: (name: string) => void;

  commit: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
  beginGesture: () => void;
  updateLive: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  select: (id: string | null) => void;
  setCropMode: (on: boolean) => void;
  updateLayer: (id: string, patch: Partial<ImageLayer>, live?: boolean) => void;

  addFiles: (files: File[]) => Promise<void>;
  removeAsset: (assetId: string) => Promise<void>;
  addLayerFromAsset: (assetId: string) => void;
  duplicateLayer: (id: string) => void;
  deleteLayer: (id: string) => void;
  reorder: (id: string, op: 'forward' | 'backward' | 'front' | 'back') => void;

  flushSave: () => Promise<void>;
}

export function assetSizes(assets: Record<string, AssetMeta>): AssetSizeMap {
  const map: AssetSizeMap = {};
  for (const [id, a] of Object.entries(assets)) map[id] = { width: a.originalWidth, height: a.originalHeight };
  return map;
}

export function toMeta(a: ImageAsset): AssetMeta {
  return {
    id: a.id,
    name: a.name,
    width: a.width,
    height: a.height,
    originalWidth: a.originalWidth,
    originalHeight: a.originalHeight,
    previewBlob: a.previewBlob,
    thumbBlob: a.thumbBlob,
  };
}

function sameDoc(a: ProjectDoc, b: ProjectDoc) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let thumbTimer: ReturnType<typeof setTimeout> | null = null;
let pendingThumbnail: Blob | undefined;

export const useEditor = create<EditorState>((set, get) => {
  const layoutDoc = (doc: ProjectDoc) => applyLayout(doc, assetSizes(get().assets));

  const scheduleSave = () => {
    set({ saveStatus: 'pending' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flushSave(), 600);
    if (thumbTimer) clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      thumbTimer = null;
      void generateThumbnail();
    }, 2500);
  };

  const generateThumbnail = async () => {
    const { doc, project } = get();
    if (!doc || !project) return;
    try {
      const canvas = document.createElement('canvas');
      const scale = 240 / doc.canvasWidth;
      await renderProject(
        canvas,
        doc,
        async (assetId) => {
          const p = await getPreviewById(assetId);
          return p ? { source: { image: p.img, width: p.width, height: p.height } } : null;
        },
        { scale, opaqueFallback: '#2c2c2e' },
      );
      pendingThumbnail = await canvasToBlob(canvas, 'image/jpeg', 0.75);
      canvas.width = 0;
      if (get().project?.id === project.id && !saveTimer) await get().flushSave();
    } catch {
      /* サムネイルは必須ではない */
    }
  };

  const setDoc = (doc: ProjectDoc) => {
    const selectedId = get().selectedId;
    const stillExists = selectedId && doc.imageLayers.some((l) => l.id === selectedId);
    set({ doc, selectedId: stillExists ? selectedId : null });
    scheduleSave();
  };

  return {
    project: null,
    doc: null,
    assets: {},
    history: emptyHistory(),
    selectedId: null,
    cropMode: false,
    gestureBefore: null,
    saveStatus: 'idle',
    saveError: null,
    importing: null,
    loadError: null,

    openProject: async (id) => {
      if (get().project?.id === id) return true;
      await get().closeProject();
      try {
        const rec = await projectsRepo.get(id);
        if (!rec) {
          set({ loadError: 'プロジェクトが見つかりません。削除されたか、ブラウザのデータが消去された可能性があります。' });
          return false;
        }
        const assetRows = await assetsRepo.listByProject(id);
        const assets: Record<string, AssetMeta> = {};
        for (const a of assetRows) assets[a.id] = toMeta(a);
        const { thumbnail: _t, ...project } = rec;
        void _t;
        // 欠損したアセットを参照するレイヤーは除外する
        const doc = docOf(project);
        const fixed: ProjectDoc = {
          ...doc,
          assetIds: doc.assetIds.filter((a) => assets[a]),
          imageLayers: doc.imageLayers.filter((l) => assets[l.assetId]),
        };
        set({
          project,
          doc: fixed,
          assets,
          history: emptyHistory(),
          selectedId: null,
          cropMode: false,
          saveStatus: 'saved',
          saveError: null,
          loadError: null,
        });
        // 表示前にプレビュー画像のデコードを開始
        for (const a of assetRows) void getPreview(a).catch(() => {});
        return true;
      } catch (e) {
        set({ loadError: e instanceof StorageError ? e.message : 'プロジェクトの読み込みに失敗しました。' });
        return false;
      }
    },

    closeProject: async () => {
      const { project, doc } = get();
      if (!project || !doc) return;
      // 一覧用サムネイルが未生成なら、閉じる前に作成する
      if (thumbTimer) {
        clearTimeout(thumbTimer);
        thumbTimer = null;
        await generateThumbnail();
      }
      await get().flushSave();
      void cleanupUnusedAssets({ id: project.id, ...doc });
      releaseAll();
      set({ project: null, doc: null, assets: {}, history: emptyHistory(), selectedId: null, cropMode: false });
    },

    rename: (name) => {
      const p = get().project;
      if (!p) return;
      set({ project: { ...p, name } });
      scheduleSave();
    },

    commit: (fn) => {
      const { doc, history } = get();
      if (!doc) return;
      const next = layoutDoc(fn(doc));
      if (sameDoc(doc, next)) return;
      set({ history: pushHistory(history, doc) });
      setDoc(next);
    },

    beginGesture: () => {
      const doc = get().doc;
      if (doc && !get().gestureBefore) set({ gestureBefore: doc });
    },

    updateLive: (fn) => {
      const doc = get().doc;
      if (!doc) return;
      set({ doc: layoutDoc(fn(doc)) });
    },

    endGesture: () => {
      const { gestureBefore, doc, history } = get();
      set({ gestureBefore: null });
      if (!gestureBefore || !doc) return;
      if (sameDoc(gestureBefore, doc)) return;
      set({ history: pushHistory(history, gestureBefore) });
      setDoc(doc);
    },

    undo: () => {
      const { doc, history } = get();
      if (!doc) return;
      const r = undoHistory(history, doc);
      if (!r) return;
      set({ history: r.history });
      setDoc(r.value);
    },

    redo: () => {
      const { doc, history } = get();
      if (!doc) return;
      const r = redoHistory(history, doc);
      if (!r) return;
      set({ history: r.history });
      setDoc(r.value);
    },

    select: (id) => set({ selectedId: id, cropMode: id ? get().cropMode : false }),
    setCropMode: (on) => set({ cropMode: on }),

    updateLayer: (id, patch, live) => {
      const asset = (l: ImageLayer) => get().assets[l.assetId];
      const fn = (doc: ProjectDoc): ProjectDoc => ({
        ...doc,
        imageLayers: doc.imageLayers.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, ...patch };
          const a = asset(next);
          return a ? recomputeCrop(next, { width: a.originalWidth, height: a.originalHeight }) : next;
        }),
      });
      if (live) get().updateLive(fn);
      else get().commit(fn);
    },

    addFiles: async (files) => {
      const { project } = get();
      if (!project || !files.length) return;
      set({ importing: { done: 0, total: files.length } });
      const added: ImageAsset[] = [];
      const errors: string[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const asset = await importImageFile(files[i], project.id);
          await assetsRepo.put(asset);
          added.push(asset);
        } catch (e) {
          if (e instanceof ImageImportError || e instanceof StorageError) errors.push(e.message);
          else errors.push(`「${files[i].name}」の追加に失敗しました（画像が大きすぎる可能性があります）。`);
          if (e instanceof StorageError && e.quota) break;
        }
        set({ importing: { done: i + 1, total: files.length } });
        await yieldToUI();
      }
      set({ importing: null });
      if (errors.length) toast.error(errors.length > 1 ? `${errors[0]}（ほか${errors.length - 1}件）` : errors[0]);
      if (!added.length || get().project?.id !== project.id) return;

      const assets = { ...get().assets };
      for (const a of added) assets[a.id] = toMeta(a);
      set({ assets });
      for (const a of added) void getPreview(a).catch(() => {});

      get().commit((doc) => {
        const canvas = { width: doc.canvasWidth, height: doc.canvasHeight };
        const rects = initialFreePlacement(added.length, canvas, (i) => added[i].originalWidth / added[i].originalHeight);
        const base = doc.imageLayers.length;
        const layers = added.map((a, i) => makeLayer(uid(), a.id, rects[i], base + i));
        return {
          ...doc,
          assetIds: [...doc.assetIds, ...added.map((a) => a.id)],
          imageLayers: [...doc.imageLayers, ...layers],
        };
      });
      toast.success(`${added.length}枚の画像を追加しました`);
    },

    removeAsset: async (assetId) => {
      get().commit((doc) => ({
        ...doc,
        assetIds: doc.assetIds.filter((a) => a !== assetId),
        imageLayers: doc.imageLayers.filter((l) => l.assetId !== assetId),
        background: doc.background.type === 'image' && doc.background.assetId === assetId ? { type: 'color', color: '#1c1c1e' } : doc.background,
      }));
      // Undo で戻せるよう、アセット本体はプロジェクト削除時まで保持する（参照が消えたものは保存時に掃除）
    },

    addLayerFromAsset: (assetId) => {
      const a = get().assets[assetId];
      if (!a) return;
      get().commit((doc) => {
        const canvas = { width: doc.canvasWidth, height: doc.canvasHeight };
        const [rect] = initialFreePlacement(1, canvas, () => a.originalWidth / a.originalHeight);
        const small = { ...rect, width: rect.width * 0.6, height: rect.height * 0.6 };
        small.x = (canvas.width - small.width) / 2;
        small.y = (canvas.height - small.height) / 2;
        const layer = makeLayer(uid(), assetId, small, doc.imageLayers.length);
        set({ selectedId: layer.id });
        return {
          ...doc,
          assetIds: doc.assetIds.includes(assetId) ? doc.assetIds : [...doc.assetIds, assetId],
          imageLayers: [...doc.imageLayers, layer],
        };
      });
    },

    duplicateLayer: (id) => {
      get().commit((doc) => {
        const src = doc.imageLayers.find((l) => l.id === id);
        if (!src) return doc;
        const offset = doc.canvasWidth * 0.04;
        const copy: ImageLayer = { ...src, id: uid(), x: src.x + offset, y: src.y + offset, zIndex: src.zIndex + 0.5, locked: false };
        set({ selectedId: copy.id });
        return { ...doc, imageLayers: normalizeLayers([...doc.imageLayers, copy]) };
      });
    },

    deleteLayer: (id) => {
      get().commit((doc) => ({ ...doc, imageLayers: normalizeLayers(doc.imageLayers.filter((l) => l.id !== id)) }));
    },

    reorder: (id, op) => {
      get().commit((doc) => {
        const layers = normalizeLayers(doc.imageLayers);
        const idx = layers.findIndex((l) => l.id === id);
        if (idx < 0) return doc;
        const [item] = layers.splice(idx, 1);
        const to = op === 'front' ? layers.length : op === 'back' ? 0 : op === 'forward' ? Math.min(layers.length, idx + 1) : Math.max(0, idx - 1);
        layers.splice(to, 0, item);
        return { ...doc, imageLayers: layers.map((l, i) => ({ ...l, zIndex: i })) };
      });
    },

    flushSave: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const { project, doc } = get();
      if (!project || !doc) return;
      const updated: ProjectRecord = { ...project, ...doc, updatedAt: Date.now() };
      if (pendingThumbnail) updated.thumbnail = pendingThumbnail;
      else {
        const prev = await projectsRepo.get(project.id).catch(() => undefined);
        if (prev?.thumbnail) updated.thumbnail = prev.thumbnail;
      }
      set({ saveStatus: 'saving' });
      try {
        await projectsRepo.put(updated);
        pendingThumbnail = undefined;
        if (get().project?.id === project.id) set({ saveStatus: 'saved', saveError: null, project: { ...get().project!, updatedAt: updated.updatedAt } });
      } catch (e) {
        const err = e instanceof StorageError ? e : toStorageError(e);
        set({ saveStatus: 'error', saveError: err.message });
        toast.error(err.message);
      }
    },
  };
});

/** 参照されなくなったアセットを削除する（プロジェクトを閉じる・ホームへ戻る際に実行） */
export async function cleanupUnusedAssets(project: Pick<Project, 'id' | 'assetIds' | 'imageLayers' | 'background'>) {
  try {
    const rows = await assetsRepo.listByProject(project.id);
    const used = new Set<string>(project.assetIds);
    project.imageLayers.forEach((l) => used.add(l.assetId));
    if (project.background.type === 'image') used.add(project.background.assetId);
    for (const a of rows) {
      if (!used.has(a.id)) {
        await assetsRepo.remove(a.id);
        releaseAsset(a.id);
      }
    }
  } catch {
    /* 失敗しても次回に再実行される */
  }
}
