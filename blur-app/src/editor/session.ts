/** 現在編集中の写真（EditorController）の管理と、写真を開く流れ */
import { LoadError, loadImage, REDUCED_PIXELS } from '../lib/loadImage';
import { applyPendingUpdate } from '../lib/pwa';
import { showToast, store } from '../state/store';
import { EditorController } from './EditorController';

let current: EditorController | null = null;
const listeners = new Set<() => void>();

export function getEditor(): EditorController | null {
  return current;
}

export function subscribeEditor(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setEditor(ed: EditorController | null) {
  current?.dispose();
  current = ed;
  listeners.forEach((l) => l());
}

function fmtMP(w: number, h: number) {
  return `${w.toLocaleString()} × ${h.toLocaleString()}（約${Math.round((w * h) / 1e6)}MP）`;
}

async function load(file: File, maxPixels?: number) {
  store.set({ busy: { message: '写真を読み込んでいます…', progress: 0 } });
  // 読み込み中のメモリを確保するため、前の写真は先に解放する
  if (current) setEditor(null);
  try {
    const img = await loadImage(file, { maxPixels, onProgress: (p) => store.set({ busy: { message: '写真を読み込んでいます…', progress: p } }) });
    const ed = new EditorController(img);
    store.set({
      image: { name: img.name, width: img.width, height: img.height, hasAlpha: img.hasAlpha, reducedFrom: img.reducedFrom },
      canUndo: false,
      canRedo: false,
      dirty: false,
      pending: null,
      comparing: false,
      zoom: 1,
    });
    setEditor(ed);
    if (img.reducedFrom) showToast(`元の ${fmtMP(img.reducedFrom.width, img.reducedFrom.height)} を ${fmtMP(img.width, img.height)} に縮小して開きました。`);
  } catch (e) {
    store.set({ image: null });
    if (e instanceof LoadError && (e.kind === 'tooLarge' || e.kind === 'memory') && e.size) {
      const size = e.size;
      const pixels = size.width * size.height;
      // 縮小する画素数：大きすぎる場合は約2400万画素、メモリ不足の場合は現在の半分ずつ
      const target = Math.floor(maxPixels ? maxPixels / 2 : e.kind === 'tooLarge' ? REDUCED_PIXELS : Math.min(REDUCED_PIXELS, pixels / 2));
      if (target < 200_000) {
        showToast('メモリが不足しているため写真を開けませんでした。他のアプリやタブを閉じてから再度お試しください。', 'error');
        return;
      }
      store.set({
        dialog: {
          title: e.kind === 'tooLarge' ? '大きな写真です' : 'メモリが不足しています',
          message: `${e.message}\n${fmtMP(size.width, size.height)}\n約${Math.max(0.1, Math.round(target / 1e5) / 10)}MP に縮小して開きますか？（書き出しも縮小したサイズになります）`,
          actions: [
            { label: 'キャンセル', kind: 'cancel' },
            { label: '縮小して開く', kind: 'primary', onSelect: () => void load(file, target) },
          ],
        },
      });
      return;
    }
    showToast(e instanceof LoadError ? e.message : '写真を読み込めませんでした。', 'error');
  } finally {
    store.set({ busy: null });
    if (!current) applyPendingUpdate();
  }
}

export function openFile(file: File) {
  void load(file);
}
