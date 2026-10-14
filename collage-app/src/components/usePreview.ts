import { useEffect, useState } from 'react';
import { getPreview, type PreviewEntry } from '../state/imageCache';
import { useEditor } from '../state/editorStore';

/** 編集画面用の縮小画像を非同期に取得する */
export function usePreview(assetId: string | undefined): PreviewEntry | null {
  const asset = useEditor((s) => (assetId ? s.assets[assetId] : undefined));
  const [entry, setEntry] = useState<PreviewEntry | null>(null);
  useEffect(() => {
    let alive = true;
    setEntry(null);
    if (!asset) return;
    getPreview(asset)
      .then((e) => alive && setEntry(e))
      .catch(() => alive && setEntry(null));
    return () => {
      alive = false;
    };
  }, [asset]);
  return entry;
}
