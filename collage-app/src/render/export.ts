import { assetsRepo } from '../storage/db';
import { canvasToBlob, loadImage } from '../lib/image';
import type { ProjectDoc } from '../model/types';
import { renderProject, type ImageResolver } from './renderProject';

export type ExportFormat = 'png' | 'jpeg';

export interface ExportResult {
  blob: Blob;
  file: File;
  width: number;
  height: number;
  format: ExportFormat;
}

export const MIME: Record<ExportFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' };

/** 書き出し用：IndexedDB から元画像（高解像度）を 1 枚ずつ読み込む */
export const masterResolver: ImageResolver = async (assetId) => {
  const asset = await assetsRepo.get(assetId);
  if (!asset) return null;
  const { img, release } = await loadImage(asset.blob);
  return { source: { image: img, width: img.naturalWidth, height: img.naturalHeight }, release };
};

/** 書き出したファイルが正しい画像として読み込めるか検証する */
export async function verifyImageBlob(blob: Blob, mime: string, width: number, height: number): Promise<void> {
  if (!blob || blob.size === 0) throw new Error('書き出した画像が空です');
  if (blob.type && blob.type !== mime) throw new Error(`画像形式が想定と異なります（${blob.type}）`);
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png' && !isPng) throw new Error('PNGファイルとして不正です');
  if (mime === 'image/jpeg' && !isJpeg) throw new Error('JPEGファイルとして不正です');
  const { img, release } = await loadImage(blob);
  try {
    if (img.naturalWidth !== width || img.naturalHeight !== height) {
      throw new Error(`画像サイズが想定と異なります（${img.naturalWidth} × ${img.naturalHeight}）`);
    }
  } finally {
    release();
  }
}

export function exportFileName(projectName: string, format: ExportFormat): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  // 日本語などの非 ASCII 文字はブラウザによってファイル名が無視されるため、英数字のみ使う
  const safe = projectName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'wallpaper';
  return `${safe}-${stamp}.${format === 'png' ? 'png' : 'jpg'}`;
}

export async function exportProject(
  doc: ProjectDoc,
  name: string,
  format: ExportFormat,
  onProgress?: (done: number, total: number) => void,
  resolver: ImageResolver = masterResolver,
): Promise<ExportResult> {
  const canvas = document.createElement('canvas');
  const mime = MIME[format];
  try {
    await renderProject(canvas, doc, resolver, {
      onProgress,
      // JPEG は透明を表現できないため、透明背景は黒で塗る
      opaqueFallback: format === 'jpeg' ? '#000000' : undefined,
    });
    const blob = await canvasToBlob(canvas, mime, format === 'jpeg' ? 0.95 : undefined);
    await verifyImageBlob(blob, mime, doc.canvasWidth, doc.canvasHeight);
    const file = new File([blob], exportFileName(name, format), { type: mime, lastModified: Date.now() });
    return { blob, file, width: doc.canvasWidth, height: doc.canvasHeight, format };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * 共有シートを開く。iOS では「画像を保存」で写真ライブラリに保存できる。
 * ユーザー操作（タップ）の直後に同期的に呼び出す必要がある。
 */
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (!canShareFile(file)) return 'unsupported';
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

/** 共有非対応環境でのフォールバック：ダウンロード */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
