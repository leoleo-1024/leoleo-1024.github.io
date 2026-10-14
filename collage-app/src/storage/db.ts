import Dexie, { type EntityTable } from 'dexie';
import { migrateProject } from '../model/project';
import type { ImageAsset, Project } from '../model/types';

export interface ProjectRecord extends Project {
  /** ホーム画面一覧用の縮小プレビュー */
  thumbnail?: Blob;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

class CollageDB extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>;
  assets!: EntityTable<ImageAsset, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor() {
    super('wallpaper-collage');
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'id, projectId',
      settings: 'key',
    });
  }
}

export const db = new CollageDB();

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly quota: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** IndexedDB のエラーをユーザー向けメッセージ付きのエラーに変換する */
export function toStorageError(e: unknown): StorageError {
  const name = (e as { name?: string; inner?: { name?: string } })?.name ?? '';
  const inner = (e as { inner?: { name?: string } })?.inner?.name ?? '';
  const quota = /Quota/i.test(name) || /Quota/i.test(inner);
  if (quota) {
    return new StorageError(
      '端末の保存容量が不足しています。不要なプロジェクトを削除するか、iPhoneの空き容量を増やしてください。',
      true,
      e,
    );
  }
  return new StorageError(
    'データの保存に失敗しました。プライベートブラウズでは保存できない場合があります。通常モードで開き直してください。',
    false,
    e,
  );
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toStorageError(e);
  }
}

export const projectsRepo = {
  list: () =>
    guard(async () => {
      const rows = await db.projects.orderBy('updatedAt').reverse().toArray();
      return rows.map((r) => migrateProject(r) as ProjectRecord);
    }),
  get: (id: string) =>
    guard(async () => {
      const r = await db.projects.get(id);
      return r ? (migrateProject(r) as ProjectRecord) : undefined;
    }),
  put: (p: ProjectRecord) => guard(() => db.projects.put(p)),
  rename: (id: string, name: string) => guard(() => db.projects.update(id, { name, updatedAt: Date.now() })),
  remove: (id: string) =>
    guard(() =>
      db.transaction('rw', db.projects, db.assets, async () => {
        await db.assets.where('projectId').equals(id).delete();
        await db.projects.delete(id);
      }),
    ),
};

export const assetsRepo = {
  listByProject: (projectId: string) => guard(() => db.assets.where('projectId').equals(projectId).toArray()),
  get: (id: string) => guard(() => db.assets.get(id)),
  put: (a: ImageAsset) => guard(() => db.assets.put(a)),
  remove: (id: string) => guard(() => db.assets.delete(id)),
};

export const settingsRepo = {
  get: async <T>(key: string, fallback: T): Promise<T> => {
    try {
      const r = await db.settings.get(key);
      return (r?.value as T) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: unknown) => guard(() => db.settings.put({ key, value })),
};

export async function clearAllData(): Promise<void> {
  await guard(() =>
    db.transaction('rw', db.projects, db.assets, db.settings, async () => {
      await db.projects.clear();
      await db.assets.clear();
      await db.settings.clear();
    }),
  );
}

export interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const info: StorageInfo = {};
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage;
      info.quota = e.quota;
    }
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
  } catch {
    /* 取得できない環境では空のまま */
  }
  return info;
}

/** ブラウザによる自動削除を避けるため、永続化を要求する（対応環境のみ） */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}
