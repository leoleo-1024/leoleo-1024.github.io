import { uid } from '../lib/id';
import { createZip, openZip, ZipError, type ZipInput, type ZipReader } from '../lib/zip';
import { DEFAULT_FIT } from '../model/geometry';
import { migrateProject } from '../model/project';
import { SCHEMA_VERSION, type Background, type Fit, type ImageAsset, type ImageLayer, type Project } from '../model/types';
import { validateCanvasSize } from '../model/presets';
import { db, StorageError, toStorageError, type ProjectRecord } from './db';

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
  /** 復元できた配置（レイヤー）の数 */
  imageCount: number;
  /** 壊れていて復元できなかった画像の数と名前 */
  skipped: number;
  skippedNames: string[];
  /** 壊れた画像を使っていたため除外した配置の数 */
  droppedLayers: number;
}

/** 復元の上限（壊れた・悪意のあるファイルからアプリを守る） */
const MAX_ASSETS = 2000;
const MAX_LAYERS = 5000;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 100_000;

/** 復元中であることを示す目印（settings テーブルに保存）。強制終了で残った場合は次回起動時に掃除する */
const IMPORT_MARKER_PREFIX = 'import:';
interface ImportMarker {
  projectId: string;
  startedAt: number;
  updatedAt: number;
}
/** 目印の更新がこの時間止まっていたら、中断された復元とみなす（他のタブで進行中の復元は消さない） */
export const INTERRUPTED_IMPORT_MS = 10 * 60 * 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 画像ファイルの先頭バイト（シグネチャ）を確認する */
async function looksLikeImage(blob: Blob): Promise<boolean> {
  const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const jpeg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  const png = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
  const gif = h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38;
  const webp = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  return jpeg || png || gif || webp;
}

const invalid = (detail: string) => new BackupError(`バックアップファイルの内容が正しくありません（${detail}）。`);

/** manifest.json の構造を検証する。不正なものは復元を始める前に拒否する */
function validateManifest(m: unknown): Manifest {
  if (!isObj(m) || m.format !== BACKUP_FORMAT || !isObj(m.project)) {
    throw new BackupError('壁紙コラージュのバックアップファイルではありません。');
  }
  if (num(m.formatVersion, 0) > BACKUP_FORMAT_VERSION || num(m.project.schemaVersion, 0) > SCHEMA_VERSION) {
    throw new BackupError('新しいバージョンのアプリで作成されたバックアップです。アプリを最新にしてから読み込んでください。');
  }
  const assets = m.assets ?? [];
  if (!Array.isArray(assets)) throw invalid('画像一覧');
  if (assets.length > MAX_ASSETS) throw invalid('画像が多すぎます');
  const layers = m.project.imageLayers ?? [];
  if (!Array.isArray(layers)) throw invalid('配置データ');
  if (layers.length > MAX_LAYERS) throw invalid('配置が多すぎます');
  const ids = new Set<string>();
  for (const a of assets) {
    if (!isObj(a) || typeof a.id !== 'string' || !a.id) throw invalid('画像のID');
    if (ids.has(a.id)) throw invalid('画像のIDが重複しています');
    ids.add(a.id);
  }
  const w = m.project.canvasWidth;
  const h = m.project.canvasHeight;
  if (typeof w !== 'number' || typeof h !== 'number' || validateCanvasSize(w, h)) throw invalid('壁紙のサイズ');
  return m as unknown as Manifest;
}

/** 1 枚分の画像を読み込む。壊れている場合は null（呼び出し側で「復元できなかった画像」として数える） */
async function readAsset(zip: ZipReader, a: ManifestAsset, projectId: string, now: number): Promise<ImageAsset | null> {
  try {
    const files = isObj(a.files) ? a.files : null;
    if (!files || typeof files.original !== 'string' || typeof files.preview !== 'string' || typeof files.thumb !== 'string') return null;
    const ow = num(a.originalWidth, 0);
    const oh = num(a.originalHeight, 0);
    if (ow <= 0 || oh <= 0 || ow > MAX_IMAGE_SIDE || oh > MAX_IMAGE_SIDE) return null;
    const blob = await zip.read(files.original, str(a.mimeType, 'image/jpeg'));
    const previewBlob = await zip.read(files.preview, str(a.types?.preview, 'image/jpeg'));
    const thumbBlob = await zip.read(files.thumb, str(a.types?.thumb, 'image/jpeg'));
    if (!(await looksLikeImage(blob)) || !(await looksLikeImage(previewBlob)) || !(await looksLikeImage(thumbBlob))) return null;
    return {
      id: uid(),
      projectId,
      blob,
      mimeType: str(a.mimeType, 'image/jpeg'),
      originalWidth: ow,
      originalHeight: oh,
      width: num(a.width, ow),
      height: num(a.height, oh),
      previewBlob,
      thumbBlob,
      name: str(a.name, 'image'),
      createdAt: num(a.createdAt, now),
    };
  } catch (e) {
    // ZIP 全体の上限超過は個別の破損ではないため、復元全体を中止する
    if (e instanceof ZipError && /合計サイズ/.test(e.message)) throw e;
    return null;
  }
}

/** 指定した（復元途中の）プロジェクト ID の画像と目印を削除する。既存プロジェクトの ID が渡ることはない */
async function discardImport(projectId: string) {
  await db.assets.where('projectId').equals(projectId).delete();
  await db.settings.delete(IMPORT_MARKER_PREFIX + projectId);
}

/**
 * 強制終了などで中断された復元の残骸を掃除する（アプリ起動時に実行）。
 * - 目印に対応するプロジェクトが存在する場合：復元は完了しているので目印だけ消す
 * - 存在せず、目印の更新が一定時間止まっている場合：保存途中の画像と目印を消す
 * 既存のプロジェクトとその画像には一切触れない。
 */
export async function cleanupInterruptedImports(now = Date.now()): Promise<number> {
  let cleaned = 0;
  try {
    const markers = await db.settings.where('key').startsWith(IMPORT_MARKER_PREFIX).toArray();
    for (const m of markers) {
      const marker = m.value as Partial<ImportMarker> | undefined;
      const projectId = m.key.slice(IMPORT_MARKER_PREFIX.length);
      if (!projectId) continue;
      if (await db.projects.get(projectId)) {
        await db.settings.delete(m.key);
        continue;
      }
      if (now - num(marker?.updatedAt, 0) < INTERRUPTED_IMPORT_MS) continue;
      await discardImport(projectId);
      cleaned++;
    }
  } catch {
    /* 次回起動時に再試行される */
  }
  return cleaned;
}

/** バックアップファイルから新しいプロジェクトとして復元する（既存データは変更しない） */
export async function importProjectBackup(file: Blob, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  let manifest: Manifest;
  let zip: ZipReader;
  try {
    zip = await openZip(file);
    if (!zip.entries.has('manifest.json')) throw new BackupError('壁紙コラージュのバックアップファイルではありません。');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await zip.readText('manifest.json', MAX_MANIFEST_BYTES));
    } catch (e) {
      if (e instanceof ZipError) throw e;
      throw invalid('manifest.json を解析できません');
    }
    manifest = validateManifest(parsed);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    if (e instanceof ZipError) throw new BackupError(`バックアップファイルを読み込めませんでした（${e.message}）。`);
    throw new BackupError('バックアップファイルを読み込めませんでした。ファイルが壊れている可能性があります。');
  }

  // 新しい ID で復元するため、既存のプロジェクトと衝突・上書きすることはない
  const projectId = uid();
  const now = Date.now();
  const markerKey = IMPORT_MARKER_PREFIX + projectId;
  const list = (manifest.assets ?? []) as ManifestAsset[];
  const assetMap = new Map<string, string>();
  const skippedNames: string[] = [];

  try {
    await db.settings.put({ key: markerKey, value: { projectId, startedAt: now, updatedAt: now } satisfies ImportMarker });
  } catch (e) {
    throw toStorageError(e);
  }

  try {
    // 画像はメモリを圧迫しないよう 1 枚ずつ読み込んで保存する
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const asset = await readAsset(zip, a, projectId, now);
      if (!asset) {
        skippedNames.push(str(a.name, `画像${i + 1}`));
      } else {
        try {
          await db.assets.put(asset);
          await db.settings.put({ key: markerKey, value: { projectId, startedAt: now, updatedAt: Date.now() } satisfies ImportMarker });
        } catch (e) {
          throw toStorageError(e);
        }
        assetMap.set(a.id, asset.id);
      }
      onProgress?.(i + 1, list.length + 1);
    }
    if (list.length > 0 && assetMap.size === 0) {
      throw new BackupError('画像を1枚も復元できませんでした。バックアップファイルが壊れている可能性があります。');
    }

    const src = manifest.project;
    const srcLayers = Array.isArray(src.imageLayers) ? src.imageLayers : [];
    const layers = srcLayers
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
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      background: sanitizeBackground(base.background, assetMap),
      layoutMode: base.layoutMode === 'grid' || base.layoutMode === 'mosaic' ? base.layoutMode : 'free',
      grid: {
        auto: bool(base.grid?.auto, true),
        rows: Math.min(12, Math.max(1, Math.round(num(base.grid?.rows, 3)))),
        cols: Math.min(8, Math.max(1, Math.round(num(base.grid?.cols, 2)))),
        gap: Math.max(0, num(base.grid?.gap, 24)),
        padding: Math.max(0, num(base.grid?.padding, 48)),
      },
      mosaic: { seed: num(base.mosaic?.seed, 1), gap: Math.max(0, num(base.mosaic?.gap, 24)), padding: Math.max(0, num(base.mosaic?.padding, 48)) },
      assetIds: (Array.isArray(base.assetIds) ? base.assetIds : []).map((id) => assetMap.get(id)).filter((id): id is string => !!id),
      imageLayers: layers,
    };
    if (manifest.thumbnail && zip.entries.has(manifest.thumbnail)) {
      const thumb = await zip.read(manifest.thumbnail, 'image/jpeg').catch(() => undefined);
      if (thumb && (await looksLikeImage(thumb))) project.thumbnail = thumb;
    }

    // 編集データの保存と目印の削除を 1 つのトランザクションで行い、「完了」を確定させる
    try {
      await db.transaction('rw', db.projects, db.settings, async () => {
        await db.projects.put(project);
        await db.settings.delete(markerKey);
      });
    } catch (e) {
      throw toStorageError(e);
    }
    onProgress?.(list.length + 1, list.length + 1);
    return {
      projectId,
      name: project.name,
      imageCount: layers.length,
      skipped: skippedNames.length,
      skippedNames,
      droppedLayers: srcLayers.length - layers.length,
    };
  } catch (e) {
    // どの段階で失敗しても、保存途中の画像と目印を取り消す（失敗した場合は次回起動時に掃除される）
    await discardImport(projectId).catch(() => {});
    if (e instanceof BackupError || e instanceof StorageError) throw e;
    if (e instanceof ZipError) throw new BackupError(`バックアップファイルを読み込めませんでした（${e.message}）。`);
    throw new BackupError('復元中にエラーが発生したため、復元を取り消しました。');
  }
}
