/** iOS 共有シート（Web Share API）と、使えない場合の代替保存 */

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * 共有シートを開く。'shared' は「共有シートで何らかの操作が完了した」ことを意味し、
 * 写真アプリへの保存が完了したかどうかはブラウザーからは分からない。
 * ※ ユーザー操作（タップ）の直後に呼ぶこと（iOS の制約）
 */
export async function shareFile(file: File): Promise<{ outcome: ShareOutcome; message?: string }> {
  if (!canShareFile(file)) return { outcome: 'unsupported' };
  try {
    await navigator.share({ files: [file] });
    return { outcome: 'shared' };
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'AbortError') return { outcome: 'cancelled' };
    return { outcome: 'failed', message: (e as Error)?.message };
  }
}

/** ダウンロード（iOS ではファイルアプリへの保存/プレビュー、PC ではダウンロードフォルダー） */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
