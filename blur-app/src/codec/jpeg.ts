/**
 * ベースライン JPEG エンコーダー（4:2:0、標準ハフマン表、AAN 浮動小数 DCT）。
 * iOS Safari の canvas 面積上限（約 1,677 万画素）を超える画像を、帯（ストリップ）単位で
 * 受け取りながら符号化するために使う。メタデータ（EXIF・位置情報）は一切書き込まない。
 */

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57,
  50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

const STD_LUM_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37,
  56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHR_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUM_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHR_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1,
  0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
  0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85,
  0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa,
  0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
  0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
  0xfa,
];
const AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42,
  0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19,
  0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83,
  0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8,
  0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
  0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
  0xfa,
];

const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

interface Huff {
  code: Uint16Array;
  len: Uint8Array;
}

function buildHuff(bits: number[], vals: number[]): Huff {
  const code = new Uint16Array(256);
  const len = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]; i++) {
      code[vals[k]] = c;
      len[vals[k]] = l;
      c++;
      k++;
    }
    c <<= 1;
  }
  return { code, len };
}

function scaleQuant(std: number[], quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = Math.min(255, Math.max(1, Math.floor((std[i] * scale + 50) / 100)));
  return out;
}

class ByteSink {
  parts: Uint8Array[] = [];
  private buf = new Uint8Array(1 << 20);
  private pos = 0;
  byte(b: number) {
    if (this.pos >= this.buf.length) this.flush();
    this.buf[this.pos++] = b;
  }
  word(w: number) {
    this.byte((w >> 8) & 0xff);
    this.byte(w & 0xff);
  }
  bytes(a: ArrayLike<number>) {
    for (let i = 0; i < a.length; i++) this.byte(a[i]);
  }
  flush() {
    if (this.pos) this.parts.push(this.buf.slice(0, this.pos));
    this.pos = 0;
  }
}

export class JpegEncoder {
  readonly width: number;
  readonly height: number;
  private sink = new ByteSink();
  private qY: Uint8Array;
  private qC: Uint8Array;
  private fdY = new Float32Array(64);
  private fdC = new Float32Array(64);
  private dcY: Huff;
  private dcC: Huff;
  private acY: Huff;
  private acC: Huff;
  private bitBuf = 0;
  private bitCnt = 0;
  private predY = 0;
  private predCb = 0;
  private predCr = 0;
  /** 16 行分の RGB 行バッファ */
  private rows: Uint8ClampedArray;
  private rowCount = 0;
  private rowsDone = 0;
  private blk = new Float32Array(64);
  private qout = new Int32Array(64);
  private finished = false;

  constructor(width: number, height: number, quality = 92) {
    if (width < 1 || height < 1 || width > 65535 || height > 65535) throw new Error('JPEG のサイズが範囲外です');
    this.width = width;
    this.height = height;
    this.qY = scaleQuant(STD_LUM_Q, quality);
    this.qC = scaleQuant(STD_CHR_Q, quality);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const i = r * 8 + c;
        this.fdY[i] = 1 / (this.qY[i] * AASF[r] * AASF[c] * 8);
        this.fdC[i] = 1 / (this.qC[i] * AASF[r] * AASF[c] * 8);
      }
    this.dcY = buildHuff(DC_LUM_BITS, DC_LUM_VALS);
    this.dcC = buildHuff(DC_CHR_BITS, DC_CHR_VALS);
    this.acY = buildHuff(AC_LUM_BITS, AC_LUM_VALS);
    this.acC = buildHuff(AC_CHR_BITS, AC_CHR_VALS);
    this.rows = new Uint8ClampedArray(width * 16 * 4);
    this.writeHeaders();
  }

  private writeHeaders() {
    const s = this.sink;
    s.word(0xffd8); // SOI
    // APP0 JFIF
    s.word(0xffe0);
    s.word(16);
    s.bytes([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    // DQT
    s.word(0xffdb);
    s.word(132);
    s.byte(0);
    for (let i = 0; i < 64; i++) s.byte(this.qY[ZIGZAG[i]]);
    s.byte(1);
    for (let i = 0; i < 64; i++) s.byte(this.qC[ZIGZAG[i]]);
    // SOF0
    s.word(0xffc0);
    s.word(17);
    s.byte(8);
    s.word(this.height);
    s.word(this.width);
    s.byte(3);
    s.bytes([1, 0x22, 0]); // Y: 2x2 サンプリング
    s.bytes([2, 0x11, 1]);
    s.bytes([3, 0x11, 1]);
    // DHT
    const tables: Array<[number, number[], number[]]> = [
      [0x00, DC_LUM_BITS, DC_LUM_VALS],
      [0x10, AC_LUM_BITS, AC_LUM_VALS],
      [0x01, DC_CHR_BITS, DC_CHR_VALS],
      [0x11, AC_CHR_BITS, AC_CHR_VALS],
    ];
    s.word(0xffc4);
    s.word(2 + tables.reduce((a, [, , v]) => a + 17 + v.length, 0));
    for (const [cls, bits, vals] of tables) {
      s.byte(cls);
      s.bytes(bits);
      s.bytes(vals);
    }
    // SOS
    s.word(0xffda);
    s.word(12);
    s.byte(3);
    s.bytes([1, 0x00, 2, 0x11, 3, 0x11]);
    s.bytes([0, 63, 0]);
  }

  private writeBits(code: number, len: number) {
    this.bitBuf = (this.bitBuf << len) | code;
    this.bitCnt += len;
    while (this.bitCnt >= 8) {
      const b = (this.bitBuf >> (this.bitCnt - 8)) & 0xff;
      this.sink.byte(b);
      if (b === 0xff) this.sink.byte(0);
      this.bitCnt -= 8;
    }
    this.bitBuf &= (1 << this.bitCnt) - 1;
  }

  /** blk（-128 済みの 8×8 サンプル）を DCT・量子化・符号化。戻り値は新しい DC 予測値 */
  private encodeBlock(fd: Float32Array, pred: number, dc: Huff, ac: Huff): number {
    const d = this.blk;
    // 行方向
    for (let o = 0; o < 64; o += 8) {
      const t0 = d[o] + d[o + 7];
      const t7 = d[o] - d[o + 7];
      const t1 = d[o + 1] + d[o + 6];
      const t6 = d[o + 1] - d[o + 6];
      const t2 = d[o + 2] + d[o + 5];
      const t5 = d[o + 2] - d[o + 5];
      const t3 = d[o + 3] + d[o + 4];
      const t4 = d[o + 3] - d[o + 4];
      let t10 = t0 + t3;
      const t13 = t0 - t3;
      let t11 = t1 + t2;
      let t12 = t1 - t2;
      d[o] = t10 + t11;
      d[o + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      d[o + 2] = t13 + z1;
      d[o + 6] = t13 - z1;
      t10 = t4 + t5;
      t11 = t5 + t6;
      t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5;
      const z4 = 1.306562965 * t12 + z5;
      const z3 = t11 * 0.707106781;
      const z11 = t7 + z3;
      const z13 = t7 - z3;
      d[o + 5] = z13 + z2;
      d[o + 3] = z13 - z2;
      d[o + 1] = z11 + z4;
      d[o + 7] = z11 - z4;
    }
    // 列方向
    for (let o = 0; o < 8; o++) {
      const t0 = d[o] + d[o + 56];
      const t7 = d[o] - d[o + 56];
      const t1 = d[o + 8] + d[o + 48];
      const t6 = d[o + 8] - d[o + 48];
      const t2 = d[o + 16] + d[o + 40];
      const t5 = d[o + 16] - d[o + 40];
      const t3 = d[o + 24] + d[o + 32];
      const t4 = d[o + 24] - d[o + 32];
      let t10 = t0 + t3;
      const t13 = t0 - t3;
      let t11 = t1 + t2;
      let t12 = t1 - t2;
      d[o] = t10 + t11;
      d[o + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      d[o + 16] = t13 + z1;
      d[o + 48] = t13 - z1;
      t10 = t4 + t5;
      t11 = t5 + t6;
      t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5;
      const z4 = 1.306562965 * t12 + z5;
      const z3 = t11 * 0.707106781;
      const z11 = t7 + z3;
      const z13 = t7 - z3;
      d[o + 40] = z13 + z2;
      d[o + 24] = z13 - z2;
      d[o + 8] = z11 + z4;
      d[o + 56] = z11 - z4;
    }
    const q = this.qout;
    for (let k = 0; k < 64; k++) {
      const n = ZIGZAG[k];
      const v = d[n] * fd[n];
      q[k] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
    }
    // DC
    const diff = q[0] - pred;
    this.writeCoef(diff, dc, 0);
    // AC
    let run = 0;
    let lastNz = 63;
    while (lastNz > 0 && q[lastNz] === 0) lastNz--;
    for (let k = 1; k <= lastNz; k++) {
      const v = q[k];
      if (v === 0) {
        run++;
        continue;
      }
      while (run >= 16) {
        this.writeBits(ac.code[0xf0], ac.len[0xf0]);
        run -= 16;
      }
      this.writeCoef(v, ac, run);
      run = 0;
    }
    if (lastNz < 63) this.writeBits(ac.code[0x00], ac.len[0x00]);
    return q[0];
  }

  private writeCoef(v: number, h: Huff, run: number) {
    const a = v < 0 ? -v : v;
    let cat = 0;
    while (a >> cat) cat++;
    const sym = (run << 4) | cat;
    this.writeBits(h.code[sym], h.len[sym]);
    if (cat) this.writeBits(v < 0 ? (v - 1) & ((1 << cat) - 1) : v, cat);
  }

  /** RGBA の行を追加する（不透明として扱う。透明部分は呼び出し側で合成しておく） */
  addRows(rgba: Uint8ClampedArray | Uint8Array, rows: number): void {
    if (this.finished) throw new Error('finished');
    const rowBytes = this.width * 4;
    for (let r = 0; r < rows; r++) {
      if (this.rowsDone + this.rowCount >= this.height) return;
      this.rows.set(rgba.subarray(r * rowBytes, (r + 1) * rowBytes), this.rowCount * rowBytes);
      this.rowCount++;
      if (this.rowCount === 16) this.encodeMcuRow();
    }
  }

  private encodeMcuRow() {
    const W = this.width;
    const valid = this.rowCount;
    const rows = this.rows;
    const rowBytes = W * 4;
    // 足りない行は最後の行を複製
    for (let r = valid; r < 16; r++) rows.copyWithin(r * rowBytes, (valid - 1) * rowBytes, valid * rowBytes);
    const blk = this.blk;
    const cb = new Float32Array(64);
    const cr = new Float32Array(64);
    for (let mx = 0; mx < W; mx += 16) {
      // Y の 4 ブロック
      for (let by = 0; by < 2; by++)
        for (let bx = 0; bx < 2; bx++) {
          for (let y = 0; y < 8; y++) {
            const row = (by * 8 + y) * rowBytes;
            for (let x = 0; x < 8; x++) {
              const px = Math.min(W - 1, mx + bx * 8 + x);
              const i = row + px * 4;
              blk[y * 8 + x] = 0.299 * rows[i] + 0.587 * rows[i + 1] + 0.114 * rows[i + 2] - 128;
            }
          }
          this.predY = this.encodeBlock(this.fdY, this.predY, this.dcY, this.acY);
        }
      // Cb, Cr（2×2 平均）
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          let sr = 0;
          let sg = 0;
          let sb = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const px = Math.min(W - 1, mx + x * 2 + dx);
              const i = (y * 2 + dy) * rowBytes + px * 4;
              sr += rows[i];
              sg += rows[i + 1];
              sb += rows[i + 2];
            }
          sr *= 0.25;
          sg *= 0.25;
          sb *= 0.25;
          cb[y * 8 + x] = -0.168736 * sr - 0.331264 * sg + 0.5 * sb;
          cr[y * 8 + x] = 0.5 * sr - 0.418688 * sg - 0.081312 * sb;
        }
      }
      blk.set(cb);
      this.predCb = this.encodeBlock(this.fdC, this.predCb, this.dcC, this.acC);
      blk.set(cr);
      this.predCr = this.encodeBlock(this.fdC, this.predCr, this.dcC, this.acC);
    }
    this.rowsDone += valid;
    this.rowCount = 0;
  }

  /** 残りを書き出して JPEG のバイト列（分割）を返す */
  finish(): Uint8Array[] {
    if (this.finished) throw new Error('finished');
    if (this.rowCount > 0) this.encodeMcuRow();
    if (this.rowsDone < this.height) throw new Error(`JPEG: rows missing (${this.rowsDone}/${this.height})`);
    // 残りのビットを 1 で埋める
    if (this.bitCnt > 0) this.writeBits((1 << (8 - this.bitCnt)) - 1, 8 - this.bitCnt);
    this.sink.word(0xffd9);
    this.sink.flush();
    this.finished = true;
    return this.sink.parts;
  }
}
