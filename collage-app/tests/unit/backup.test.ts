// @vitest-environment node
// Node 標準の Blob は IndexedDB（fake-indexeddb）に保存しても Blob のまま復元されるため node 環境で実行する
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { crc32, createZip, openZip, ZipError } from '../../src/lib/zip';
import { createProject } from '../../src/model/project';
import { makeLayer } from '../../src/model/layout';
import { assetsRepo, db, projectsRepo } from '../../src/storage/db';
import { BackupError, exportProjectBackup, importProjectBackup } from '../../src/storage/backup';
import type { ImageAsset } from '../../src/model/types';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('zip', () => {
  it('CRC32 が既知の値と一致する', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('書き出した ZIP を読み戻せる（日本語ファイル名・バイナリ・空ファイル）', async () => {
    const bin = bytes(0, 1, 2, 250, 255);
    const zip = await createZip([
      { name: 'manifest.json', data: '{"a":"日本語"}' },
      { name: 'assets/画像.bin', data: new Blob([bin]) },
      { name: 'empty.txt', data: '' },
    ]);
    const r = await openZip(zip);
    expect([...r.entries.keys()]).toEqual(['manifest.json', 'assets/画像.bin', 'empty.txt']);
    expect(await r.readText('manifest.json')).toBe('{"a":"日本語"}');
    expect(new Uint8Array(await (await r.read('assets/画像.bin')).arrayBuffer())).toEqual(bin);
    expect((await r.read('empty.txt')).size).toBe(0);
  });

  it('壊れたデータは CRC で検出する', async () => {
    const zip = await createZip([{ name: 'a.txt', data: 'hello world' }]);
    const buf = new Uint8Array(await zip.arrayBuffer());
    const idx = buf.indexOf('h'.charCodeAt(0), 30);
    buf[idx] ^= 0xff; // 中身を 1 バイト改ざん
    const r = await openZip(new Blob([buf]));
    await expect(r.read('a.txt')).rejects.toBeInstanceOf(ZipError);
  });

  it('PC で再圧縮された（DEFLATE）ZIP も読み込める', async () => {
    // 無圧縮 ZIP を作り、中身を DEFLATE に置き換えた ZIP を組み立てる
    const text = 'deflate テスト '.repeat(50);
    const raw = new TextEncoder().encode(text);
    const comp = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const name = new TextEncoder().encode('a.txt');
    const crc = crc32(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 8, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, comp.length, true); cd.setUint32(24, raw.length, true); cd.setUint16(28, name.length, true);
    const eocd = new DataView(new ArrayBuffer(22));
    const cdOffset = 30 + name.length + comp.length;
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, 1, true); eocd.setUint16(10, 1, true);
    eocd.setUint32(12, 46 + name.length, true); eocd.setUint32(16, cdOffset, true);
    const zip = new Blob([lh.buffer, name, comp, cd.buffer, name, eocd.buffer]);
    const r = await openZip(zip);
    expect(await r.readText('a.txt')).toBe(text);
  });

  it('ZIP 以外のファイルはエラー', async () => {
    await expect(openZip(new Blob(['not a zip file at all, definitely not']))).rejects.toBeInstanceOf(ZipError);
  });
});

function asset(id: string, projectId: string, content: number): ImageAsset {
  const blob = new Blob([bytes(content, content, content)], { type: 'image/png' });
  return {
    id,
    projectId,
    blob,
    mimeType: 'image/png',
    originalWidth: 400,
    originalHeight: 300,
    width: 400,
    height: 300,
    previewBlob: new Blob([bytes(content + 1)], { type: 'image/png' }),
    thumbBlob: new Blob([bytes(content + 2)], { type: 'image/jpeg' }),
    name: `${id}.png`,
    createdAt: 1,
  };
}

describe('project backup', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  async function seed() {
    const p = createProject('バックアップテスト');
    p.assetIds = ['a1', 'a2'];
    p.imageLayers = [
      { ...makeLayer('l1', 'a1', { x: 10, y: 20, width: 400, height: 300 }, 0), rotation: 15, opacity: 0.5, flipX: true },
      makeLayer('l2', 'a1', { x: 50, y: 60, width: 200, height: 150 }, 1), // 同じ画像を 2 回配置
    ];
    p.background = { type: 'image', assetId: 'a3', fit: { zoom: 2, focusX: 0.3, focusY: 0.7 }, color: '#123456' };
    p.layoutMode = 'free';
    await projectsRepo.put({ ...p, thumbnail: new Blob([bytes(7)], { type: 'image/jpeg' }) });
    await assetsRepo.put(asset('a1', p.id, 10));
    await assetsRepo.put(asset('a2', p.id, 20));
    await assetsRepo.put(asset('a3', p.id, 30)); // 背景画像
    await assetsRepo.put(asset('orphan', p.id, 40)); // どこからも参照されない
    return p;
  }

  it('書き出し → 復元で編集内容と画像が一致し、ID は新しくなる', async () => {
    const p = await seed();
    const file = await exportProjectBackup(p.id);
    expect(file.name).toMatch(/^collage-backup-.*\.zip$/);
    const zip = await openZip(file);
    expect([...zip.entries.keys()].some((n) => n.includes('orphan'))).toBe(false);

    const r = await importProjectBackup(file);
    expect(r.projectId).not.toBe(p.id);
    expect(r.imageCount).toBe(2);
    expect(r.skipped).toBe(0);

    const restored = (await projectsRepo.get(r.projectId))!;
    expect(restored.name).toBe('バックアップテスト');
    expect(restored.imageLayers).toHaveLength(2);
    const [l1, l2] = restored.imageLayers;
    expect(l1.rotation).toBe(15);
    expect(l1.opacity).toBe(0.5);
    expect(l1.flipX).toBe(true);
    expect(l1.assetId).toBe(l2.assetId); // 同じ画像の参照共有を維持
    expect(l1.assetId).not.toBe('a1');
    expect(restored.assetIds).toHaveLength(2);
    expect(restored.background.type).toBe('image');
    if (restored.background.type === 'image') {
      expect(restored.background.fit).toEqual({ zoom: 2, focusX: 0.3, focusY: 0.7 });
      const bg = (await assetsRepo.get(restored.background.assetId))!;
      expect(new Uint8Array(await bg.blob.arrayBuffer())).toEqual(bytes(30, 30, 30));
    }
    const a = (await assetsRepo.get(l1.assetId))!;
    expect(a.projectId).toBe(r.projectId);
    expect(new Uint8Array(await a.blob.arrayBuffer())).toEqual(bytes(10, 10, 10));
    expect(new Uint8Array(await a.previewBlob.arrayBuffer())).toEqual(bytes(11));
    expect(restored.thumbnail).toBeTruthy();

    // 元のプロジェクトは変更されない
    expect((await projectsRepo.get(p.id))!.imageLayers[0].id).toBe('l1');
    expect((await assetsRepo.listByProject(p.id)).length).toBe(4);
  });

  it('同じファイルを 2 回読み込んでも別々のプロジェクトになる', async () => {
    const p = await seed();
    const file = await exportProjectBackup(p.id);
    const a = await importProjectBackup(file);
    const b = await importProjectBackup(file);
    expect(a.projectId).not.toBe(b.projectId);
    expect((await projectsRepo.list()).length).toBe(3);
  });

  it('別のアプリの ZIP や新しい形式はわかりやすいエラー', async () => {
    const other = await createZip([{ name: 'hello.txt', data: 'hi' }]);
    await expect(importProjectBackup(other)).rejects.toBeInstanceOf(BackupError);
    const future = await createZip([{ name: 'manifest.json', data: JSON.stringify({ format: 'wallpaper-collage-project', formatVersion: 99, project: {} }) }]);
    await expect(importProjectBackup(future)).rejects.toThrow('新しいバージョン');
    await expect(importProjectBackup(new Blob(['garbage']))).rejects.toBeInstanceOf(BackupError);
    expect((await projectsRepo.list()).length).toBe(0);
  });
});
