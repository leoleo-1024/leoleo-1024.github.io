/**
 * ストリーミング PNG エンコーダー（8bit RGBA / RGB、Paeth フィルター）。
 * 圧縮は CompressionStream('deflate')（zlib 形式）を使い、使えない環境では無圧縮の deflate ブロックで出力する。
 * メタデータは書き込まない。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const t = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  return [u32(data.length), t, data, u32(crc32([t, data]))];
}

/** CompressionStream が無いときの無圧縮 zlib ストリーム */
class StoredDeflate {
  private parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  private a = 1;
  private b = 0;
  private pending: Uint8Array[] = [];
  private pendingLen = 0;
  write(data: Uint8Array) {
    for (let i = 0; i < data.length; i++) {
      this.a = (this.a + data[i]) % 65521;
      this.b = (this.b + this.a) % 65521;
    }
    this.pending.push(data);
    this.pendingLen += data.length;
    while (this.pendingLen >= 65535) this.emit(65535, false);
  }
  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const p = this.pending[0];
      const k = Math.min(p.length, n - o);
      out.set(p.subarray(0, k), o);
      o += k;
      if (k === p.length) this.pending.shift();
      else this.pending[0] = p.subarray(k);
    }
    this.pendingLen -= n;
    return out;
  }
  private emit(n: number, final: boolean) {
    const data = this.take(n);
    this.parts.push(new Uint8Array([final ? 1 : 0, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff]), data);
  }
  finish(): Uint8Array[] {
    this.emit(this.pendingLen, true);
    this.parts.push(u32(((this.b << 16) | this.a) >>> 0));
    return this.parts;
  }
}

export class PngEncoder {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  private out: Uint8Array[] = [];
  private prev: Uint8Array;
  private cur: Uint8Array;
  private rowsDone = 0;
  private writer: WritableStreamDefaultWriter<BufferSource> | null = null;
  private readerDone: Promise<void> | null = null;
  private stored: StoredDeflate | null = null;
  private idat: Uint8Array[] = [];
  private idatLen = 0;

  constructor(width: number, height: number, hasAlpha: boolean, forceStored = false) {
    this.width = width;
    this.height = height;
    this.channels = hasAlpha ? 4 : 3;
    const rowLen = width * this.channels;
    this.prev = new Uint8Array(rowLen);
    this.cur = new Uint8Array(rowLen + 1);
    this.out.push(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const ihdr = new Uint8Array(13);
    ihdr.set(u32(width), 0);
    ihdr.set(u32(height), 4);
    ihdr[8] = 8;
    ihdr[9] = hasAlpha ? 6 : 2;
    this.out.push(...chunk('IHDR', ihdr));
    if (!forceStored && typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate');
      this.writer = cs.writable.getWriter();
      const reader = cs.readable.getReader();
      this.readerDone = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) this.pushIdat(value);
        }
      })();
    } else {
      this.stored = new StoredDeflate();
    }
  }

  private pushIdat(data: Uint8Array) {
    this.idat.push(data);
    this.idatLen += data.length;
    if (this.idatLen >= 1 << 20) this.flushIdat();
  }

  private flushIdat() {
    if (!this.idatLen) return;
    const data = new Uint8Array(this.idatLen);
    let o = 0;
    for (const p of this.idat) {
      data.set(p, o);
      o += p.length;
    }
    this.out.push(...chunk('IDAT', data));
    this.idat = [];
    this.idatLen = 0;
  }

  /** RGBA の行を追加する */
  async addRows(rgba: Uint8ClampedArray | Uint8Array, rows: number): Promise<void> {
    const W = this.width;
    const ch = this.channels;
    const bpp = ch;
    const rowLen = W * ch;
    const block = new Uint8Array((rowLen + 1) * rows);
    let bo = 0;
    for (let r = 0; r < rows && this.rowsDone < this.height; r++, this.rowsDone++) {
      const cur = this.cur;
      // RGBA → RGB(A)
      const src = r * W * 4;
      if (ch === 4) cur.set(rgba.subarray(src, src + W * 4), 1);
      else for (let x = 0, s = src, d = 1; x < W; x++, s += 4, d += 3) {
        cur[d] = rgba[s];
        cur[d + 1] = rgba[s + 1];
        cur[d + 2] = rgba[s + 2];
      }
      // Paeth フィルター
      const prev = this.prev;
      block[bo++] = 4;
      for (let i = 0; i < rowLen; i++) {
        const x = cur[i + 1];
        const a = i >= bpp ? cur[i + 1 - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = p > a ? p - a : a - p;
        const pb = p > b ? p - b : b - p;
        const pc = p > c ? p - c : c - p;
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        block[bo++] = (x - pred) & 0xff;
      }
      prev.set(cur.subarray(1));
    }
    const data = block.subarray(0, bo);
    if (this.writer) await this.writer.write(data);
    else this.stored!.write(data.slice());
  }

  async finish(): Promise<Uint8Array[]> {
    if (this.rowsDone < this.height) throw new Error(`PNG: rows missing (${this.rowsDone}/${this.height})`);
    if (this.writer) {
      await this.writer.close();
      await this.readerDone;
    } else {
      for (const p of this.stored!.finish()) this.pushIdat(p);
    }
    this.flushIdat();
    this.out.push(...chunk('IEND', new Uint8Array(0)));
    return this.out;
  }
}
