import { uid } from '../lib/id';
import { createZip, openZip, ZipError, type ZipInput } from '../lib/zip';
import { DEFAULT_FIT } from '../model/geometry';
import { migrateProject } from '../model/project';
import { SCHEMA_VERSION, type Background, type Fit, type ImageAsset, type ImageLayer, type Project } from '../model/types';
import { db, toStorageError, type ProjectRecord } from './db';

/**
 * プロジェクトのバックアップ（1 つの .zip ファイル）。
 *
 * 構成:
 *   manifest.json                  … 形式情報・プロジェクトの編集データ・アセット一覧
 *   assets/<id>/original|preview|thumb … 画像本体（書き出し用・編集用・一覧用）
 *   thumbnail.jpg                  … ホーム画面用サムネイル（任意）
 *
 * 読み込み時はプロジェクト・アセットに新しい ID を振り直すため、
 * 同じファイルを何度読み込んでも既存のデータを上書きしない。
 */

export const BACKUP_FORMAT = 'wallpaper-collage-project';
export const BACKUP_FORMAT_VERSION = 1;

export class BackupError extends Error {}

interface ManifestAsset {
  id: string;
  name: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  createdAt: number;
  files: { original: string; preview: string; thumb: string };
  types: { preview: string; thumb: string };
}

interface Manifest {
  format: string;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  project: Project;
  assets: ManifestAsset[];
  thumbnail?: string;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const ext = (mime: string) => EXT[mime] ?? 'bin';

export function backupFileName(projectName: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  // 非 ASCII 文字はブラウザによってファイル名が無視されるため英数字のみ使う
  const safe = projectName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `collage-backup-${safe ? `${safe}-` : ''}${stamp}.zip`;
}

/** プロジェクトをバックアップファイルにまとめる */
export async function exportProjectBackup(projectId: string, onProgress?: (done: number, total: number) => void): Promise<File> {
  let record: ProjectRecord | undefined;
  let assets: ImageAsset[];
  try {
    record = await db.projects.get(projectId);
    assets = await db.assets.where('projectId').equals(projectId).toArray();
  } catch (e) {
    throw toStorageError(e);
  }
  if (!record) throw new BackupError('プロジェクトが見つかりません。');
  const { thumbnail, ...project } = record;

  // 参照されているアセットだけを含める（削除済みで未掃除のものは除く）
  const used = new Set<string>(project.assetIds);
  project.imageLayers.forEach((l) => used.add(l.assetId));
  if (project.background.type === 'image') used.add(project.background.assetId);
  const included = assets.filter((a) => used.has(a.id));

  const files: ZipInput[] = [];
  const manifestAssets: ManifestAsset[] = included.map((a) => {
    const base = `assets/${a.id}`;
    const entry: ManifestAsset = {
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      originalWidth: a.originalWidth,
      originalHeight: a.originalHeight,
      width: a.width,
      height: a.height,
      createdAt: a.createdAt,
      files: {
        original: `${base}/original.${ext(a.mimeType)}`,
        preview: `${base}/preview.${ext(a.previewBlob.type)}`,
        thumb: `${base}/thumb.${ext(a.thumbBlob.type)}`,
      },
      types: { preview: a.previewBlob.type || 'image/jpeg', thumb: a.thumbBlob.type || 'image/jpeg' },
    };
    files.push(
      { name: entry.files.original, data: a.blob },
      { name: entry.files.preview, data: a.previewBlob },
      { name: entry.files.thumb, data: a.thumbBlob },
    );
    return entry;
  });
  if (thumbnail) files.push({ name: 'thumbnail.jpg', data: thumbnail });

  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
    exportedAt: new Date().toISOString(),
    project,
    assets: manifestAssets,
    thumbnail: thumbnail ? 'thumbnail.jpg' : undefined,
  };
  files.unshift({ name: 'manifest.json', data: JSON.stringify(manifest) });

  const blob = await createZip(files, onProgress);
  return new File([blob], backupFileName(project.name), { type: 'application/zip', lastModified: Date.now() });
}

// ---------------- 読み込み ----------------

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

function sanitizeFit(f: unknown): Fit {
  const o = (f ?? {}) as Partial<Fit>;
  return { zoom: num(o.zoom, DEFAULT_FIT.zoom), focusX: num(o.focusX, DEFAULT_FIT.focusX), focusY: num(o.focusY, DEFAULT_FIT.focusY) };
}

function sanitizeLayer(l: unknown, assetMap: Map<string, string>): ImageLayer | null {
  const o = (l ?? {}) as Partial<ImageLayer>;
  const assetId = assetMap.get(str(o.assetId, ''));
  if (!assetId) return null;
  const width = num(o.width, 0);
  const height = num(o.height, 0);
  if (width <= 0 || height <= 0) return null;
  const c = (o.crop ?? {}) as Partial<ImageLayer['crop']>;
  return {
    id: uid(),
    assetId,
    x: num(o.x, 0),
    y: num(o.y, 0),
    width,
    height,
    rotation: num(o.rotation, 0),
    opacity: Math.min(1, Math.max(0, num(o.opacity, 1))),
    flipX: bool(o.flipX, false),
    flipY: bool(o.flipY, false),
    crop: { x: num(c.x, 0), y: num(c.y, 0), width: num(c.width, 1), height: num(c.height, 1) },
    fit: sanitizeFit(o.fit),
    borderRadius: Math.max(0, num(o.borderRadius, 0)),
    zIndex: num(o.zIndex, 0),
    visible: bool(o.visible, true),
    locked: bool(o.locked, false),
  };
}

function sanitizeBackground(b: unknown, assetMap: Map<string, string>): Background {
  const o = (b ?? {}) as Record<string, unknown>;
  if (o.type === 'gradient') return { type: 'gradient', from: str(o.from, '#000000'), to: str(o.to, '#000000'), angle: num(o.angle, 180) };
  if (o.type === 'transparent') return { type: 'transparent' };
  if (o.type === 'image') {
    const assetId = assetMap.get(str(o.assetId, ''));
    if (assetId) return { type: 'image', assetId, fit: sanitizeFit(o.fit), color: str(o.color, '#000000') };
  }
  return { type: 'color', color: o.type === 'color' ? str(o.color, '#1c1c1e') : '#1c1c1e' };
}

export interface ImportResult {
  projectId: string;
  name: string;
  imageCount: number;
  skipped: number;
}

/** バックアップファイルから新しいプロジェクトとして復元する（既存データは変更しない） */
export async function importProjectBackup(file: Blob, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  let manifest: Manifest;
  let zip;
  try {
    zip = await openZip(file);
    if (!zip.entries.has('manifest.json')) throw new BackupError('壁紙コラージュのバックアップファイルではありません。');
    manifest = JSON.parse(await zip.readText('manifest.json')) as Manifest;
  } catch (e) {
    if (e instanceof BackupError) throw e;
    if (e instanceof ZipError) throw new BackupError(`バックアップファイルを読み込めませんでした（${e.message}）。`);
    throw new BackupError('バックアップファイルを読み込めませんでした。ファイルが壊れている可能性があります。');
  }
  if (manifest?.format !== BACKUP_FORMAT || !manifest.project) {
    throw new BackupError('壁紙コラージュのバックアップファイルではありません。');
  }
  if (num(manifest.formatVersion, 0) > BACKUP_FORMAT_VERSION || num(manifest.project.schemaVersion, 0) > SCHEMA_VERSION) {
    throw new BackupError('新しいバージョンのアプリで作成されたバックアップです。アプリを最新にしてから読み込んでください。');
  }

  const projectId = uid();
  const now = Date.now();
  const assetMap = new Map<string, string>();
  const savedAssetIds: string[] = [];
  const list = Array.isArray(manifest.assets) ? manifest.assets : [];
  let skipped = 0;

  // 画像はメモリを圧迫しないよう 1 枚ずつ読み込んで保存し、失敗時はまとめて取り消す
  const rollback = async () => {
    await db.assets.bulkDelete(savedAssetIds).catch(() => {});
  };

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    let asset: ImageAsset;
    try {
      const newId = uid();
      asset = {
        id: newId,
        projectId,
        blob: await zip.read(a.files.original, str(a.mimeType, 'image/jpeg')),
        mimeType: str(a.mimeType, 'image/jpeg'),
        originalWidth: num(a.originalWidth, 1),
        originalHeight: num(a.originalHeight, 1),
        width: num(a.width, num(a.originalWidth, 1)),
        height: num(a.height, num(a.originalHeight, 1)),
        previewBlob: await zip.read(a.files.preview, str(a.types?.preview, 'image/jpeg')),
        thumbBlob: await zip.read(a.files.thumb, str(a.types?.thumb, 'image/jpeg')),
        name: str(a.name, 'image'),
        createdAt: num(a.createdAt, now),
      };
    } catch {
      // 壊れた画像は除外し、残りは復元する
      skipped++;
      onProgress?.(i + 1, list.length + 1);
      continue;
    }
    try {
      await db.assets.put(asset);
    } catch (e) {
      await rollback();
      throw toStorageError(e);
    }
    savedAssetIds.push(asset.id);
    assetMap.set(str(a.id, ''), asset.id);
    onProgress?.(i + 1, list.length + 1);
  }

  const src = manifest.project;
  const layers = (Array.isArray(src.imageLayers) ? src.imageLayers : [])
    .map((l) => sanitizeLayer(l, assetMap))
    .filter((l): l is ImageLayer => !!l)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((l, i) => ({ ...l, zIndex: i }));
  const base = migrateProject({ ...src, schemaVersion: num(src.schemaVersion, SCHEMA_VERSION) });
  const project: ProjectRecord = {
    id: projectId,
    name: str(base.name, '復元したプロジェクト'),
    createdAt: num(base.createdAt, now),
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    presetId: str(base.presetId, 'custom'),
    canvasWidth: num(base.canvasWidth, 1179),
    canvasHeight: num(base.canvasHeight, 2556),
    background: sanitizeBackground(base.background, assetMap),
    layoutMode: base.layoutMode === 'grid' || base.layoutMode === 'mosaic' ? base.layoutMode : 'free',
    grid: {
      auto: bool(base.grid?.auto, true),
      rows: Math.max(1, Math.round(num(base.grid?.rows, 3))),
      cols: Math.max(1, Math.round(num(base.grid?.cols, 2))),
      gap: num(base.grid?.gap, 24),
      padding: num(base.grid?.padding, 48),
    },
    mosaic: { seed: num(base.mosaic?.seed, 1), gap: num(base.mosaic?.gap, 24), padding: num(base.mosaic?.padding, 48) },
    assetIds: (Array.isArray(base.assetIds) ? base.assetIds : []).map((id) => assetMap.get(id)).filter((id): id is string => !!id),
    imageLayers: layers,
  };
  if (manifest.thumbnail && zip.entries.has(manifest.thumbnail)) {
    project.thumbnail = await zip.read(manifest.thumbnail, 'image/jpeg').catch(() => undefined);
  }

  try {
    // 編集データは最後に保存する。これが失敗した場合は画像も取り消し、中途半端なデータを残さない
    await db.projects.put(project);
  } catch (e) {
    await rollback();
    throw toStorageError(e);
  }
  onProgress?.(list.length + 1, list.length + 1);
  return { projectId, name: project.name, imageCount: layers.length, skipped };
}
