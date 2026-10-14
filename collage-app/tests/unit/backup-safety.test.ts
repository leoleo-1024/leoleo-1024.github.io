// @vitest-environment node
// 復元処理・ZIP 読み込みの異常系テスト（Node 標準の Blob を IndexedDB に保存するため node 環境で実行）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32, createZip, openZip, ZipError } from '../../src/lib/zip';
import { createProject } from '../../src/model/project';
import { makeLayer } from '../../src/model/layout';
import { assetsRepo, db, projectsRepo, StorageError } from '../../src/storage/db';
import {
  BackupError,
  cleanupInterruptedImports,
  exportProjectBackup,
  importProjectBackup,
  INTERRUPTED_IMPORT_MS,
} from '../../src/storage/backup';
import type { ImageAsset } from '../../src/model/types';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (...n: number[]) => new Uint8Array([...PNG, ...n]);

async function bytesOf(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

/** DB の状態（プロジェクト数・画像数・復元中の目印の数） */
async function dbState() {
  return {
    projects: await db.projects.count(),
    assets: await db.assets.count(),
    markers: await db.settings.where('key').startsWith('import:').count(),
  };
}

function asset(id: string, projectId: string, n: number): ImageAsset {
  const b = new Blob([png(n)], { type: 'image/png' });
  return { id, projectId, blob: b, mimeType: 'image/png', originalWidth: 400, originalHeight: 300, width: 400, height: 300, previewBlob: b, thumbBlob: b, name: `${id}.png`, createdAt: 1 };
}

async function seedProject() {
  const p = createProject('既存プロジェクト');
  p.assetIds = ['a1', 'a2', 'a3'];
  p.imageLayers = ['a1', 'a2', 'a3'].map((a, i) => makeLayer(`l${i}`, a, { x: 0, y: 0, width: 400, height: 300 }, i));
  await projectsRepo.put(p);
  for (const [i, a] of p.assetIds.entries()) await assetsRepo.put(asset(a, p.id, i));
  return p;
}

interface ManifestOpts {
  assets?: unknown[];
  layers?: unknown[];
  project?: Record<string, unknown>;
}

/** 任意の内容のバックアップ ZIP を作る */
async function backupZip(files: Record<string, Uint8Array | string>, m: ManifestOpts | string) {
  const manifest =
    typeof m === 'string'
      ? m
      : JSON.stringify({
          format: 'wallpaper-collage-project',
          formatVersion: 1,
          project: { name: '手作り', canvasWidth: 1179, canvasHeight: 2556, schemaVersion: 1, imageLayers: m.layers ?? [], assetIds: [], background: { type: 'color', color: '#000000' }, ...m.project },
          assets: m.assets ?? [],
        });
  return createZip([
    { name: 'manifest.json', data: manifest },
    ...Object.entries(files).map(([name, data]) => ({ name, data: typeof data === 'string' ? data : new Blob([data as BlobPart]) })),
  ]);
}

const manifestAsset = (id: string, name = `${id}.png`) => ({
  id,
  name,
  mimeType: 'image/png',
  originalWidth: 400,
  originalHeight: 300,
  width: 400,
  height: 300,
  createdAt: 1,
  files: { original: `assets/${id}/o.png`, preview: `assets/${id}/p.png`, thumb: `assets/${id}/t.png` },
  types: { preview: 'image/png', thumb: 'image/png' },
});
const assetFiles = (id: string, original: Uint8Array = png(1)) => ({
  [`assets/${id}/o.png`]: original,
  [`assets/${id}/p.png`]: png(2),
  [`assets/${id}/t.png`]: png(3),
});
const layerFor = (assetId: string, i: number) => ({ ...makeLayer(`L${i}`, assetId, { x: 0, y: 0, width: 400, height: 300 }, i) });

/** DEFLATE で圧縮したエントリを 1 つ持つ ZIP を組み立てる（宣言サイズを偽ることもできる） */
async function deflateZip(raw: Uint8Array, declaredSize = raw.length) {
  const comp = new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const name = new TextEncoder().encode('big.bin');
  const crc = crc32(raw);
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true);
  lh.setUint16(8, 8, true);
  lh.setUint32(14, crc, true);
  lh.setUint32(18, comp.length, true);
  lh.setUint32(22, declaredSize, true);
  lh.setUint16(26, name.length, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true);
  cd.setUint16(10, 8, true);
  cd.setUint32(16, crc, true);
  cd.setUint32(20, comp.length, true);
  cd.setUint32(24, declaredSize, true);
  cd.setUint16(28, name.length, true);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, 46 + name.length, true);
  eocd.setUint32(16, 30 + name.length + comp.length, true);
  return new Blob([lh.buffer, name, comp, cd.buffer, name, eocd.buffer]);
}

describe('ZIP 読み込みの安全性', () => {
  it('CRC が不正な ZIP を拒否する', async () => {
    const zip = await createZip([{ name: 'a.txt', data: 'hello world' }]);
    const buf = await bytesOf(zip);
    buf[30 + 'a.txt'.length] ^= 0xff; // データの先頭 1 バイトを改ざん
    const r = await openZip(new Blob([buf]));
    await expect(r.read('a.txt')).rejects.toThrow(ZipError);
  });

  it('中央ディレクトリが途中で切れている ZIP を拒否する', async () => {
    const buf = await bytesOf(await createZip([{ name: 'a.txt', data: 'x'.repeat(100) }, { name: 'b.txt', data: 'y' }]));
    const eocd = buf.slice(buf.length - 22);
    const cdOffset = new DataView(eocd.buffer).getUint32(16, true);
    const truncated = new Blob([buf.slice(0, cdOffset + 20), eocd]); // 中央ディレクトリの大半を削除
    await expect(openZip(truncated)).rejects.toThrow(/中央ディレクトリ/);
  });

  it('ローカルヘッダーのオフセットが不正な ZIP を拒否する', async () => {
    const buf = await bytesOf(await createZip([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'world' }]));
    const dv = new DataView(buf.buffer);
    const cdOffset = dv.getUint32(buf.length - 22 + 16, true);
    // 範囲外のオフセット
    const outOfRange = buf.slice();
    new DataView(outOfRange.buffer).setUint32(cdOffset + 42, 0x7fffffff, true);
    await expect(openZip(new Blob([outOfRange]))).rejects.toThrow(/オフセット/);
    // 範囲内だがヘッダーではない位置
    const misaligned = buf.slice();
    new DataView(misaligned.buffer).setUint32(cdOffset + 42, 3, true);
    const r = await openZip(new Blob([misaligned]));
    await expect(r.read('a.txt')).rejects.toThrow(/ローカルヘッダー/);
  });

  it('解凍後サイズが異常に大きい ZIP（ZIP 爆弾）を、メモリに展開する前に拒否する', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024); // 4MB の 0 → 数 KB に圧縮される
    const honest = await deflateZip(zeros);
    expect(honest.size).toBeLessThan(64 * 1024);
    // 宣言サイズが上限を超える
    const r1 = await openZip(honest, { maxEntrySize: 1024 * 1024 });
    await expect(r1.read('big.bin')).rejects.toThrow(/大きすぎ/);
    // 宣言サイズを小さく偽っても、実際に解凍した量で打ち切る
    const lying = await deflateZip(zeros, 1000);
    const r2 = await openZip(lying, { maxEntrySize: 1024 * 1024 });
    await expect(r2.read('big.bin')).rejects.toThrow(/大きすぎ/);
  });

  it('ファイル全体・エントリ数・累計サイズの上限', async () => {
    const zip = await createZip([{ name: 'a', data: 'x'.repeat(600) }, { name: 'b', data: 'y'.repeat(600) }]);
    await expect(openZip(zip, { maxFileSize: 100 })).rejects.toThrow(/大きすぎ/);
    await expect(openZip(zip, { maxEntries: 1 })).rejects.toThrow(/ファイル数/);
    const r = await openZip(zip, { maxTotalSize: 1000 });
    await r.read('a');
    await expect(r.read('b')).rejects.toThrow(/合計サイズ/);
  });

  it('正常な DEFLATE の ZIP は読める', async () => {
    const data = new TextEncoder().encode('ok '.repeat(1000));
    const r = await openZip(await deflateZip(data));
    expect(await r.readText('big.bin')).toBe('ok '.repeat(1000));
  });
});

describe('復元の安全性', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
    await db.open();
  });

  it('不正な manifest.json は復元を始める前に拒否し、何も保存しない', async () => {
    const cases: [string, Blob][] = [
      ['JSON ではない', await backupZip({}, '{not json')],
      ['オブジェクトではない', await backupZip({}, '[1,2,3]')],
      ['画像 ID の重複', await backupZip({ ...assetFiles('x') }, { assets: [manifestAsset('x'), manifestAsset('x')] })],
      ['画像 ID が空', await backupZip({}, { assets: [{ ...manifestAsset('x'), id: '' }] })],
      ['キャンバス 0×0', await backupZip({}, { project: { canvasWidth: 0, canvasHeight: 0 } })],
      ['キャンバスが巨大', await backupZip({}, { project: { canvasWidth: 1e9, canvasHeight: 1e9 } })],
      ['キャンバスが文字列', await backupZip({}, { project: { canvasWidth: '1179', canvasHeight: 2556 } })],
      ['配置が配列ではない', await backupZip({}, { project: { imageLayers: { a: 1 } } })],
      ['画像一覧が配列ではない', await backupZip({}, { assets: 'abc' as unknown as unknown[] })],
    ];
    for (const [label, zip] of cases) {
      await expect(importProjectBackup(zip), label).rejects.toBeInstanceOf(BackupError);
    }
    expect(await dbState()).toEqual({ projects: 0, assets: 0, markers: 0 });
  });

  it('画像の保存途中で IndexedDB エラーが起きたら、保存済みの画像を取り消す（既存データは無傷）', async () => {
    const p = await seedProject();
    const file = await exportProjectBackup(p.id);
    const before = await dbState();
    const realPut = db.assets.put.bind(db.assets);
    let calls = 0;
    vi.spyOn(db.assets, 'put').mockImplementation(((...args: Parameters<typeof realPut>) => {
      if (++calls === 2) return Promise.reject(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
      return realPut(...args);
    }) as typeof db.assets.put);
    const err = await importProjectBackup(file).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).quota).toBe(true);
    vi.restoreAllMocks();
    expect(await dbState()).toEqual(before);
    expect((await projectsRepo.get(p.id))!.imageLayers).toHaveLength(3);
  });

  it('復元途中で処理が中断（例外）しても、途中までのデータを残さない', async () => {
    const p = await seedProject();
    const file = await exportProjectBackup(p.id);
    const before = await dbState();
    let n = 0;
    const err = await importProjectBackup(file, () => {
      if (++n === 2) throw new Error('中断');
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(await dbState()).toEqual(before);
  });

  it('強制終了で残った復元途中のデータは、次回起動時に掃除される（既存プロジェクトと進行中の復元は消さない）', async () => {
    const p = await seedProject();
    const now = Date.now();
    // 強制終了で残った状態：目印（更新が止まっている）＋プロジェクトのない画像
    await db.settings.put({ key: 'import:dead', value: { projectId: 'dead', startedAt: now - INTERRUPTED_IMPORT_MS * 2, updatedAt: now - INTERRUPTED_IMPORT_MS - 1 } });
    await assetsRepo.put(asset('d1', 'dead', 1));
    await assetsRepo.put(asset('d2', 'dead', 2));
    // 別のタブで進行中の復元（目印が最近更新されている）
    await db.settings.put({ key: 'import:live', value: { projectId: 'live', startedAt: now, updatedAt: now - 1000 } });
    await assetsRepo.put(asset('v1', 'live', 3));
    // 完了したが目印だけ残ったもの（プロジェクトが存在する）
    await db.settings.put({ key: `import:${p.id}`, value: { projectId: p.id, startedAt: 0, updatedAt: 0 } });

    expect(await cleanupInterruptedImports(now)).toBe(1);
    expect(await assetsRepo.listByProject('dead')).toHaveLength(0);
    expect(await assetsRepo.listByProject('live')).toHaveLength(1);
    expect(await db.settings.get('import:dead')).toBeUndefined();
    expect(await db.settings.get('import:live')).toBeTruthy();
    expect(await db.settings.get(`import:${p.id}`)).toBeUndefined();
    // 既存プロジェクトは無傷
    expect(await assetsRepo.listByProject(p.id)).toHaveLength(3);
    expect((await projectsRepo.get(p.id))!.imageLayers).toHaveLength(3);
  });

  it('正常に復元すると目印は残らない', async () => {
    const p = await seedProject();
    await importProjectBackup(await exportProjectBackup(p.id));
    expect((await dbState()).markers).toBe(0);
  });

  it('壊れた画像は除外し、どの画像・配置が復元されなかったかを返す', async () => {
    const zip = await backupZip(
      { ...assetFiles('ok'), ...assetFiles('bad', new TextEncoder().encode('これは画像ではない')) },
      { assets: [manifestAsset('ok', 'ok.png'), manifestAsset('bad', '壊れた写真.jpg')], layers: [layerFor('ok', 0), layerFor('bad', 1), layerFor('bad', 2)] },
    );
    const r = await importProjectBackup(zip);
    expect(r.imageCount).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.skippedNames).toEqual(['壊れた写真.jpg']);
    expect(r.droppedLayers).toBe(2);
    expect(await assetsRepo.listByProject(r.projectId)).toHaveLength(1);
  });

  it('画像が 1 枚も復元できない場合は復元全体を取り消す', async () => {
    const zip = await backupZip({ ...assetFiles('bad', new Uint8Array([1, 2, 3])) }, { assets: [manifestAsset('bad')], layers: [layerFor('bad', 0)] });
    await expect(importProjectBackup(zip)).rejects.toThrow(/1枚も復元できません/);
    expect(await dbState()).toEqual({ projects: 0, assets: 0, markers: 0 });
  });

  it('manifest に記載されたファイルが ZIP にない画像は「壊れた画像」として扱う', async () => {
    const zip = await backupZip({ ...assetFiles('ok') }, { assets: [manifestAsset('ok'), manifestAsset('missing')], layers: [layerFor('ok', 0), layerFor('missing', 1)] });
    const r = await importProjectBackup(zip);
    expect(r.skipped).toBe(1);
    expect(r.droppedLayers).toBe(1);
  });
});
