/**
 * 最小限の ZIP 書き出し・読み込み（プロジェクトのバックアップ用）。
 *
 * - 書き出しは無圧縮（STORE）。画像は既に圧縮済みのため圧縮しても小さくならない。
 *   各ファイルの Blob をそのまま連結するので、全画像を 1 つの巨大なバッファにコピーせずに済み、
 *   iPhone でもメモリ消費を抑えられる（CRC 計算のため 1 ファイルずつ読み込む）。
 * - 読み込みは STORE と DEFLATE（PC で解凍・再圧縮された場合）に対応。DEFLATE は
 *   ブラウザ標準の DecompressionStream を使い、非対応環境ではエラーにする。
 * - ZIP64（4GB 超・65535 ファイル超）は非対応。
 */

export class ZipError extends Error {}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export interface ZipInput {
  name: string;
  data: Blob | string;
}

const MAX_U32 = 0xffffffff;

/** ファイル群を無圧縮 ZIP の Blob にまとめる */
export async function createZip(files: ZipInput[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  if (files.length >= 0xffff) throw new ZipError('ファイル数が多すぎます');
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const blob = typeof f.data === 'string' ? new Blob([enc.encode(f.data)]) : f.data;
    const crc = crc32(await blobBytes(blob)); // 1 ファイルずつ読み込み、計算後は破棄
    const size = blob.size;
    const name = enc.encode(f.name);
    if (offset + size + 30 + name.length > MAX_U32) throw new ZipError('バックアップのサイズが大きすぎます（4GB 超）');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 ファイル名
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, blob);

    const cd = new DataView(new ArrayBuffer(46 + name.length));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    new Uint8Array(cd.buffer).set(name, 46);
    central.push(new Uint8Array(cd.buffer));

    offset += 30 + name.length + size;
    onProgress?.(i + 1, files.length);
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), eocd.buffer], { type: 'application/zip' });
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface ZipReader {
  entries: Map<string, ZipEntry>;
  /** 中身を Blob として取り出す（CRC を検証） */
  read: (name: string, type?: string) => Promise<Blob>;
  readText: (name: string) => Promise<string>;
}

async function view(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** ZIP を開く（ファイル全体はメモリに読み込まず、必要な部分だけ読む） */
export async function openZip(file: Blob): Promise<ZipReader> {
  if (file.size < 22) throw new ZipError('ZIP ファイルではありません');
  const tailStart = Math.max(0, file.size - (0xffff + 22));
  const tail = await view(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('ZIP ファイルではないか、壊れています');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === MAX_U32 || cdOffset + cdSize > file.size) throw new ZipError('対応していない ZIP 形式です');

  const cd = await view(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new ZipError('ZIP ファイルが壊れています');
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    entries.set(name, {
      name,
      method: cd.getUint16(p + 10, true),
      crc: cd.getUint32(p + 16, true),
      compressedSize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      localOffset: cd.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const read = async (name: string, type = ''): Promise<Blob> => {
    const e = entries.get(name);
    if (!e) throw new ZipError(`ファイルが見つかりません：${name}`);
    const lh = await view(file, e.localOffset, e.localOffset + 30);
    if (lh.getUint32(0, true) !== 0x04034b50) throw new ZipError('ZIP ファイルが壊れています');
    const start = e.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = file.slice(start, start + e.compressedSize);
    let out: Blob;
    if (e.method === 0) {
      out = raw;
    } else if (e.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new ZipError('この環境では圧縮された ZIP を読み込めません');
      const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out = await new Response(stream).blob();
    } else {
      throw new ZipError('対応していない圧縮形式です');
    }
    const bytes = await blobBytes(out);
    if (bytes.length !== e.size || crc32(bytes) !== e.crc) throw new ZipError(`ファイルが壊れています：${name}`);
    return new Blob([bytes as BlobPart], { type });
  };

  return {
    entries,
    read,
    readText: async (name) => (await read(name)).text(),
  };
}
