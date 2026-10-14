import { uid } from './id';
import type { ImageAsset } from '../model/types';

/** 書き出し用に保持する元画像の長辺上限（メモリ・保存容量の保護） */
export const MASTER_MAX_SIDE = 4096;
/** 編集画面で使う縮小画像の長辺 */
export const PREVIEW_MAX_SIDE = 1024;
export const THUMB_MAX_SIDE = 240;

export class ImageImportError extends Error {}

export interface LoadedImage {
  img: HTMLImageElement;
  release: () => void;
}

/**
 * Blob を <img> としてデコードする。
 * iOS Safari / Chrome は <img> の描画時に EXIF の向きを自動で反映するため、
 * naturalWidth/Height も向き補正後のサイズになる。
 */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  const release = () => {
    img.src = '';
    URL.revokeObjectURL(url);
  };
  try {
    img.src = url;
    if (img.decode) {
      await img.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('decode failed'));
      });
    }
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
    return { img, release };
  } catch (e) {
    release();
    throw e;
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b && b.size > 0 ? resolve(b) : reject(new Error('画像の生成に失敗しました（メモリ不足の可能性があります）'))),
      type,
      quality,
    );
  });
}

function scaledSize(w: number, h: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

async function resizeTo(img: HTMLImageElement, maxSide: number, type: string, quality = 0.9) {
  const size = scaledSize(img.naturalWidth, img.naturalHeight, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size.width, size.height);
  try {
    const blob = await canvasToBlob(canvas, type, quality);
    return { blob, ...size };
  } finally {
    // iOS Safari は canvas のメモリ解放が遅いため明示的に縮める
    canvas.width = 0;
    canvas.height = 0;
  }
}

const ALPHA_TYPES = ['image/png', 'image/webp', 'image/gif'];

export function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export function isSupportedFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
}

/** ファイルを読み込み、元画像・プレビュー・サムネイルを生成する */
export async function importImageFile(file: File, projectId: string): Promise<ImageAsset> {
  if (!isSupportedFile(file)) {
    throw new ImageImportError(`「${file.name}」は画像ファイルではないため追加できません。`);
  }
  let loaded: LoadedImage;
  try {
    loaded = await loadImage(file);
  } catch {
    if (isHeic(file)) {
      throw new ImageImportError(
        `「${file.name}」はHEIC形式のため、このブラウザでは読み込めません。iPhoneのSafariで写真ライブラリから選ぶと自動でJPEGに変換されます。または「設定 > カメラ > フォーマット > 互換性優先」をお試しください。`,
      );
    }
    throw new ImageImportError(`「${file.name}」を読み込めませんでした。ファイルが壊れているか、非対応の形式です。`);
  }
  const { img, release } = loaded;
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const alpha = ALPHA_TYPES.includes(file.type);
    const outType = alpha ? 'image/png' : 'image/jpeg';

    let blob: Blob = file;
    let width = w;
    let height = h;
    let mimeType = file.type || 'image/jpeg';
    // 極端に大きい画像・HEIC などは、向きを反映した状態で扱いやすい形式に変換して保持
    if (Math.max(w, h) > MASTER_MAX_SIDE || isHeic(file) || !/image\/(jpeg|png|webp|gif)/.test(file.type)) {
      const m = await resizeTo(img, MASTER_MAX_SIDE, outType, 0.92);
      blob = m.blob;
      width = m.width;
      height = m.height;
      mimeType = outType;
    }
    const preview = await resizeTo(img, PREVIEW_MAX_SIDE, outType, 0.85);
    const thumb = await resizeTo(img, THUMB_MAX_SIDE, outType, 0.8);
    return {
      id: uid(),
      projectId,
      blob,
      mimeType,
      originalWidth: w,
      originalHeight: h,
      width,
      height,
      previewBlob: preview.blob,
      thumbBlob: thumb.blob,
      name: file.name,
      createdAt: Date.now(),
    };
  } finally {
    release();
  }
}

/** UI の描画を止めないよう、次のフレームまで処理を譲る */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}
