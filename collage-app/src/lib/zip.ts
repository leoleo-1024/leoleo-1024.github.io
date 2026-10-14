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
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** 読み込み時の上限（悪意のある・壊れた ZIP からメモリを守る） */
export interface ZipLimits {
  /** ZIP ファイル全体の最大サイズ */
  maxFileSize: number;
  /** エントリ数の上限 */
  maxEntries: number;
  /** 1 エントリの解凍後の最大サイズ */
  maxEntrySize: number;
  /** 読み出した（解凍後の）データの累計上限 */
  maxTotalSize: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxFileSize: 2 * 1024 ** 3,
  maxEntries: 20_000,
  maxEntrySize: 256 * 1024 ** 2,
  maxTotalSize: 3 * 1024 ** 3,
};

export interface ZipReader {
  entries: Map<string, ZipEntry>;
  /** 中身を Blob として取り出す（サイズ上限と CRC を検証） */
  read: (name: string, type?: string, maxSize?: number) => Promise<Blob>;
  readText: (name: string, maxSize?: number) => Promise<string>;
}

async function view(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/**
 * DEFLATE を解凍する。解凍しながらサイズを数え、上限を超えた時点で中断するため、
 * 圧縮率の極端に高いデータ（ZIP 爆弾）でも巨大なメモリを確保しない。
 */
async function inflateLimited(raw: Blob, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('この環境では圧縮された ZIP を読み込めません');
  const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new ZipError('解凍後のサイズが大きすぎます');
      chunks.push(value);
    }
  } catch (e) {
    void reader.cancel().catch(() => {});
    if (e instanceof ZipError) throw e;
    throw new ZipError('圧縮データが壊れています');
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** ZIP を開く（ファイル全体はメモリに読み込まず、必要な部分だけ読む） */
export async function openZip(file: Blob, limits: Partial<ZipLimits> = {}): Promise<ZipReader> {
  const L: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...limits };
  if (file.size < 22) throw new ZipError('ZIP ファイルではありません');
  if (file.size > L.maxFileSize) throw new ZipError('ファイルが大きすぎます');
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
  const eocdPos = tailStart + eocd;
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (tail.getUint16(eocd + 4, true) !== 0 || tail.getUint16(eocd + 6, true) !== 0 || tail.getUint16(eocd + 8, true) !== count) {
    throw new ZipError('分割された ZIP には対応していません');
  }
  if (cdOffset === MAX_U32 || count === 0xffff) throw new ZipError('対応していない ZIP 形式です（ZIP64）');
  if (count > L.maxEntries) throw new ZipError('ファイル数が多すぎます');
  // 中央ディレクトリは EOCD の直前に収まっている必要がある
  if (cdOffset + cdSize > eocdPos || count * 46 > cdSize) throw new ZipError('ZIP ファイルが壊れています（中央ディレクトリ）');

  const cd = await view(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder('utf-8', { fatal: false });
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new ZipError('ZIP ファイルが壊れています（中央ディレクトリ）');
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > cd.byteLength) throw new ZipError('ZIP ファイルが壊れています（中央ディレクトリ）');
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    const entry: ZipEntry = {
      name,
      flags: cd.getUint16(p + 8, true),
      method: cd.getUint16(p + 10, true),
      crc: cd.getUint32(p + 16, true),
      compressedSize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      localOffset: cd.getUint32(p + 42, true),
    };
    if (entries.has(name)) throw new ZipError('ZIP ファイルが壊れています（同名のファイルが重複）');
    // ローカルヘッダーとデータは中央ディレクトリより前に収まっている必要がある
    if (entry.localOffset + 30 + entry.compressedSize > cdOffset) throw new ZipError('ZIP ファイルが壊れています（オフセット）');
    entries.set(name, entry);
    p += 46 + nameLen + extraLen + commentLen;
  }

  let totalRead = 0;
  const read = async (name: string, type = '', maxSize = L.maxEntrySize): Promise<Blob> => {
    const e = entries.get(name);
    if (!e) throw new ZipError(`ファイルが見つかりません：${name}`);
    if (e.flags & 0x1) throw new ZipError('暗号化された ZIP には対応していません');
    const limit = Math.min(maxSize, L.maxEntrySize);
    if (e.size > limit) throw new ZipError(`ファイルが大きすぎます：${name}`);
    if (totalRead + e.size > L.maxTotalSize) throw new ZipError('バックアップの合計サイズが大きすぎます');

    const lh = await view(file, e.localOffset, e.localOffset + 30);
    if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw new ZipError('ZIP ファイルが壊れています（ローカルヘッダー）');
    const start = e.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + e.compressedSize > cdOffset) throw new ZipError('ZIP ファイルが壊れています（オフセット）');
    const raw = file.slice(start, start + e.compressedSize);
    let bytes: Uint8Array;
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw new ZipError(`ファイルが壊れています：${name}`);
      bytes = await blobBytes(raw);
    } else if (e.method === 8) {
      // 宣言サイズを信用せず、実際に解凍した量で上限を判定する
      bytes = await inflateLimited(raw, Math.min(limit, e.size));
    } else {
      throw new ZipError('対応していない圧縮形式です');
    }
    if (bytes.length !== e.size || crc32(bytes) !== e.crc) throw new ZipError(`ファイルが壊れています：${name}`);
    totalRead += bytes.length;
    return new Blob([bytes as BlobPart], { type });
  };

  return {
    entries,
    read,
    readText: async (name, maxSize) => (await read(name, '', maxSize)).text(),
  };
}
