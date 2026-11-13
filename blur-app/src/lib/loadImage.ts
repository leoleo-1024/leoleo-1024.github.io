/**
 * 写真の読み込み。<img> でデコードし（EXIF の向きはブラウザーが反映）、
 * canvas 上限を超えないよう帯ごとに描いて画素を取り出す。
 */
import { buildPyramid } from '../engine/pixels';
import type { Level } from '../engine/types';

export type LoadErrorKind = 'unsupported' | 'decode' | 'memory' | 'tooLarge';

export class LoadError extends Error {
  constructor(
    public kind: LoadErrorKind,
    message: string,
    public size?: { width: number; height: number },
  ) {
    super(message);
  }
}

export interface LoadedImage {
  levels: Level[];
  width: number;
  height: number;
  hasAlpha: boolean;
  name: string;
  reducedFrom?: { width: number; height: number };
}

/** 確認なしで元解像度のまま開く上限（48MP 級までは元解像度で扱う） */
export const MAX_FULL_PIXELS = 50_000_000;
/** 縮小して開くときの画素数 */
export const REDUCED_PIXELS = 24_000_000;

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i;

export function isProbablyImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function decode(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    if (img.decode) await img.decode().catch(() => {});
  } catch {
    URL.revokeObjectURL(url);
    const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
    throw new LoadError(
      'decode',
      heic
        ? 'この環境では HEIC/HEIF 画像を読み込めません。iPhone の写真ライブラリから選ぶか、JPEG に変換してから開いてください。'
        : 'この画像は読み込めませんでした。JPEG・PNG・WebP 形式の画像を選んでください。',
    );
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new LoadError('decode', '画像のサイズを取得できませんでした。別の画像を選んでください。');
  }
  return { img, url };
}

/** 画像の向き補正後のサイズだけを調べる */
export async function probeSize(file: File): Promise<{ width: number; height: number }> {
  const { img, url } = await decode(file);
  const size = { width: img.naturalWidth, height: img.naturalHeight };
  img.src = '';
  URL.revokeObjectURL(url);
  return size;
}

export async function loadImage(
  file: File,
  opts: { maxPixels?: number; onProgress?: (p: number) => void } = {},
): Promise<LoadedImage> {
  if (!isProbablyImage(file)) throw new LoadError('unsupported', '画像ファイルを選んでください（JPEG・PNG・WebP など）。');
  const { img, url } = await decode(file);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  let canvas: HTMLCanvasElement | null = null;
  try {
    const limit = opts.maxPixels ?? MAX_FULL_PIXELS;
    let w = W;
    let h = H;
    if (W * H > limit) {
      if (!opts.maxPixels) throw new LoadError('tooLarge', '画像が大きすぎます。', { width: W, height: H });
      const s = Math.sqrt(limit / (W * H));
      w = Math.max(1, Math.floor(W * s));
      h = Math.max(1, Math.floor(H * s));
    }
    let data: Uint8ClampedArray;
    try {
      data = new Uint8ClampedArray(w * h * 4);
    } catch {
      throw new LoadError('memory', 'メモリが不足しているため、この解像度では開けません。', { width: W, height: H });
    }
    const stripH = Math.max(1, Math.min(h, Math.floor(4_000_000 / w)));
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = stripH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new LoadError('memory', '画像処理用の領域を確保できませんでした。', { width: W, height: H });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    let anyOpaque = false;
    let hasAlpha = false;
    for (let y = 0; y < h; y += stripH) {
      const rows = Math.min(stripH, h - y);
      ctx.clearRect(0, 0, w, stripH);
      if (w === W && h === H) ctx.drawImage(img, 0, y, W, rows, 0, 0, W, rows);
      else ctx.drawImage(img, 0, -y, w, h);
      const part = ctx.getImageData(0, 0, w, rows).data;
      for (let i = 3; i < part.length; i += 4) {
        if (part[i] !== 255) hasAlpha = true;
        if (part[i] !== 0) anyOpaque = true;
        if (hasAlpha && anyOpaque) break;
      }
      data.set(part, y * w * 4);
      opts.onProgress?.(((y + rows) / h) * 0.8);
      await tick();
    }
    if (!anyOpaque) {
      // iOS でメモリが足りないと、エラーにならず真っ白（透明）な画素が返ることがある
      throw new LoadError('memory', '画像の画素を読み取れませんでした（メモリ不足の可能性があります）。', { width: W, height: H });
    }
    let levels: Level[];
    try {
      levels = buildPyramid({ w, h, f: 1, data });
    } catch {
      throw new LoadError('memory', 'メモリが不足しているため、この解像度では開けません。', { width: W, height: H });
    }
    opts.onProgress?.(1);
    return {
      levels,
      width: w,
      height: h,
      hasAlpha,
      name: file.name || 'photo',
      reducedFrom: w !== W || h !== H ? { width: W, height: H } : undefined,
    };
  } catch (e) {
    if (e instanceof LoadError) throw e;
    if (e instanceof RangeError) throw new LoadError('memory', 'メモリが不足しているため、この解像度では開けません。', { width: W, height: H });
    throw new LoadError('decode', '画像を読み込めませんでした。');
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.src = '';
    URL.revokeObjectURL(url);
  }
}
