import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../src/model/project';
import { makeLayer } from '../../src/model/layout';
import { projectsRepo, assetsRepo, db } from '../../src/storage/db';
import { useEditor } from '../../src/state/editorStore';
import type { ImageAsset } from '../../src/model/types';

function fakeAsset(id: string, projectId: string): ImageAsset {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  return { id, projectId, blob, mimeType: 'image/png', originalWidth: 400, originalHeight: 300, width: 400, height: 300, previewBlob: blob, thumbBlob: blob, name: `${id}.png`, createdAt: 0 };
}

async function setup() {
  const p = createProject('テスト');
  p.assetIds = ['a1'];
  p.imageLayers = [makeLayer('l1', 'a1', { x: 0, y: 0, width: 400, height: 300 }, 0)];
  await projectsRepo.put(p);
  await assetsRepo.put(fakeAsset('a1', p.id));
  await useEditor.getState().closeProject();
  expect(await useEditor.getState().openProject(p.id)).toBe(true);
  return p;
}

describe('editor store', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('ドラッグ中の連続更新は 1 回の履歴になる', async () => {
    await setup();
    const s = useEditor.getState();
    s.beginGesture();
    for (let i = 1; i <= 10; i++) s.updateLive((d) => ({ ...d, imageLayers: d.imageLayers.map((l) => ({ ...l, x: l.x + i })) }));
    s.endGesture();
    expect(useEditor.getState().history.past).toHaveLength(1);
    const moved = useEditor.getState().doc!.imageLayers[0].x;
    useEditor.getState().undo();
    expect(useEditor.getState().doc!.imageLayers[0].x).toBe(200);
    useEditor.getState().redo();
    expect(useEditor.getState().doc!.imageLayers[0].x).toBe(moved);
  });

  it('複製は同じ画像アセットを参照する', async () => {
    await setup();
    useEditor.getState().duplicateLayer('l1');
    const layers = useEditor.getState().doc!.imageLayers;
    expect(layers).toHaveLength(2);
    expect(layers[0].assetId).toBe(layers[1].assetId);
    expect(new Set(layers.map((l) => l.id)).size).toBe(2);
    expect(useEditor.getState().selectedId).toBe(layers[1].id);
  });

  it('重なり順の変更と削除・背景変更が Undo できる', async () => {
    await setup();
    const s = useEditor.getState();
    s.duplicateLayer('l1');
    const copyId = useEditor.getState().selectedId!;
    s.reorder(copyId, 'back');
    expect(useEditor.getState().doc!.imageLayers.find((l) => l.id === copyId)!.zIndex).toBe(0);
    s.deleteLayer('l1');
    s.commit((d) => ({ ...d, background: { type: 'color', color: '#ff0000' } }));
    expect(useEditor.getState().doc!.imageLayers).toHaveLength(1);
    s.undo();
    s.undo();
    expect(useEditor.getState().doc!.imageLayers).toHaveLength(2);
    expect(useEditor.getState().doc!.background).toEqual({ type: 'color', color: '#1c1c1e' });
  });

  it('保存して開き直すと編集内容が復元される', async () => {
    const p = await setup();
    useEditor.getState().commit((d) => ({ ...d, background: { type: 'color', color: '#123456' } }));
    useEditor.getState().rename('新しい名前');
    await useEditor.getState().flushSave();
    await useEditor.getState().closeProject();
    await useEditor.getState().openProject(p.id);
    expect(useEditor.getState().project!.name).toBe('新しい名前');
    expect(useEditor.getState().doc!.background).toEqual({ type: 'color', color: '#123456' });
  });

  it('参照されていないアセットはプロジェクトを閉じると削除される', async () => {
    const p = await setup();
    await assetsRepo.put(fakeAsset('orphan', p.id));
    await useEditor.getState().closeProject();
    await new Promise((r) => setTimeout(r, 50));
    const rows = await assetsRepo.listByProject(p.id);
    expect(rows.map((r) => r.id)).toEqual(['a1']);
  });
});
