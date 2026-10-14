import { assetsRepo } from '../storage/db';
import { loadImage } from '../lib/image';
import type { ImageAsset } from '../model/types';

/**
 * 編集画面用の縮小画像キャッシュ。
 * 開いているプロジェクトの画像だけを保持し、閉じたら解放する。
 */
export interface PreviewEntry {
  img: HTMLImageElement;
  width: number;
  height: number;
  release: () => void;
}

const previews = new Map<string, Promise<PreviewEntry>>();
const thumbUrls = new Map<string, string>();

export function getPreview(asset: Pick<ImageAsset, 'id' | 'previewBlob'>): Promise<PreviewEntry> {
  let p = previews.get(asset.id);
  if (!p) {
    p = loadImage(asset.previewBlob).then(({ img, release }) => ({
      img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release,
    }));
    p.catch(() => previews.delete(asset.id));
    previews.set(asset.id, p);
  }
  return p;
}

export async function getPreviewById(assetId: string): Promise<PreviewEntry | null> {
  if (previews.has(assetId)) return previews.get(assetId)!;
  const asset = await assetsRepo.get(assetId);
  return asset ? getPreview(asset) : null;
}

export function thumbUrl(asset: Pick<ImageAsset, 'id' | 'thumbBlob'>): string {
  let url = thumbUrls.get(asset.id);
  if (!url) {
    url = URL.createObjectURL(asset.thumbBlob);
    thumbUrls.set(asset.id, url);
  }
  return url;
}

export function releaseAsset(assetId: string) {
  previews.get(assetId)?.then((e) => e.release()).catch(() => {});
  previews.delete(assetId);
  const url = thumbUrls.get(assetId);
  if (url) URL.revokeObjectURL(url);
  thumbUrls.delete(assetId);
}

export function releaseAll() {
  for (const id of [...previews.keys(), ...thumbUrls.keys()]) releaseAsset(id);
}
