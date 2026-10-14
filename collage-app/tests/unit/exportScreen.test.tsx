import 'fake-indexeddb/auto';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, docOf } from '../../src/model/project';
import { db } from '../../src/storage/db';
import { useEditor } from '../../src/state/editorStore';
import type { ExportFormat } from '../../src/render/export';

/**
 * 書き出し画面の並行実行テスト。
 * 実際の高解像度レンダリングの代わりに、所要時間と中止（AbortSignal）を再現するモックを使い、
 * 同時に何件のレンダリングが走ったかを数える。
 */
const stats = vi.hoisted(() => ({ active: 0, maxActive: 0, started: [] as string[], completed: [] as string[], aborted: 0 }));

vi.mock('../../src/render/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/export')>();
  return {
    ...actual,
    exportProject: async (doc: { canvasWidth: number; canvasHeight: number }, _name: string, format: ExportFormat, onProgress?: (d: number, t: number) => void, _r?: unknown, signal?: AbortSignal) => {
      stats.started.push(format);
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      try {
        // 「画像 1 枚ずつ描画」に相当する処理。各段階で中止を確認する
        for (let i = 0; i < 5; i++) {
          if (signal?.aborted) {
            stats.aborted++;
            throw new DOMException('aborted', 'AbortError');
          }
          await new Promise((r) => setTimeout(r, 20));
          onProgress?.(i + 1, 5);
        }
        stats.completed.push(format);
        const blob = new Blob(['x'], { type: actual.MIME[format] });
        return { blob, file: new File([blob], `w.${format}`), width: doc.canvasWidth, height: doc.canvasHeight, format };
      } finally {
        stats.active--;
      }
    },
  };
});

const { ExportScreen } = await import('../../src/screens/ExportScreen');

let container: HTMLDivElement;
let root: Root;

async function waitFor(cond: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const resultText = () => container.querySelector('[data-testid="export-result"]')?.textContent ?? '';
const tab = (label: string) => [...container.querySelectorAll('button[role="tab"]')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
  Object.assign(stats, { active: 0, maxActive: 0, started: [], completed: [], aborted: 0 });
  await db.delete();
  await db.open();
  const p = createProject('テスト');
  useEditor.setState({ project: p, doc: docOf(p), assets: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useEditor.setState({ project: null, doc: null });
});

describe('書き出し画面の自動書き出し', () => {
  it('StrictMode でも高解像度レンダリングは 1 回だけ実行される', async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <ExportScreen projectId="p" />
        </StrictMode>,
      );
    });
    await waitFor(() => resultText().includes('PNG'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(stats.started).toEqual(['png']);
    expect(stats.maxActive).toBe(1);
  });

  it('PNG/JPEG を高速に切り替えても並行実行せず、最後に選んだ形式の結果だけを表示する', async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <ExportScreen projectId="p" />
        </StrictMode>,
      );
    });
    await waitFor(() => stats.started.length > 0);
    // 書き出し中に連続で切り替える（実画面では進捗表示中でも素早いタップで起こりうる）
    for (const label of ['JPEG', 'PNG', 'JPEG', 'PNG', 'JPEG']) {
      await act(async () => {
        tab(label).click();
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    await waitFor(() => resultText().includes('JPEG'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(stats.maxActive).toBe(1);
    expect(stats.completed).toEqual(['jpeg']); // 途中の書き出しは中止されて完了しない
    // 要求は 6 回（初回＋切り替え 5 回）。順番待ち中に古くなった要求はレンダリング自体を開始しない
    expect(stats.started.length).toBeLessThan(6);
    expect(resultText()).toContain('JPEG');
  });

  it('画面を離れると実行中の書き出しを中止し、結果を反映しない', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    await act(async () => {
      root.render(<ExportScreen projectId="p" />);
    });
    await waitFor(() => stats.started.length > 0);
    await act(async () => root.unmount());
    await new Promise((r) => setTimeout(r, 200));
    expect(stats.completed).toEqual([]);
    expect(stats.aborted).toBe(1);
    expect(errors).toEqual([]); // アンマウント後の状態更新などの警告が出ない
    spy.mockRestore();
    root = createRoot(container); // afterEach 用
  });
});
