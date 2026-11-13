import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PngEncoder } from '../../src/codec/png';
import { JpegEncoder } from '../../src/codec/jpeg';
import { editedFileName } from '../../src/lib/export';

function concat(parts: Uint8Array[]) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 最小限の PNG デコーダー（テスト用、Paeth/None のみ） */
function decodePng(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8);
      h = dv.getUint32(o + 12);
      ct = bytes[o + 17];
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(concat(idat));
  const ch = ct === 6 ? 4 : 3;
  const out = new Uint8Array(w * h * ch);
  const rl = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (rl + 1)];
    for (let i = 0; i < rl; i++) {
      const x = raw[y * (rl + 1) + 1 + i];
      const a = i >= ch ? out[y * rl + i - ch] : 0;
      const b = y > 0 ? out[(y - 1) * rl + i] : 0;
      const c = i >= ch && y > 0 ? out[(y - 1) * rl + i - ch] : 0;
      let pred = 0;
      if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * rl + i] = (x + pred) & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

function testImage(w: number, h: number, alpha: boolean) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = (i * 7) % 256;
    d[i * 4 + 1] = (i * 13) % 256;
    d[i * 4 + 2] = (i * 3) % 256;
    d[i * 4 + 3] = alpha ? (i * 5) % 256 : 255;
  }
  return d;
}

describe('PNG encoder', () => {
  for (const forceStored of [false, true])
    for (const alpha of [false, true])
      it(`round-trips (alpha=${alpha}, stored=${forceStored})`, async () => {
        const w = 53;
        const h = 41;
        const img = testImage(w, h, alpha);
        const enc = new PngEncoder(w, h, alpha, forceStored);
        await enc.addRows(img.subarray(0, w * 4 * 20), 20);
        await enc.addRows(img.subarray(w * 4 * 20), h - 20);
        const png = decodePng(concat(await enc.finish()));
        expect([png.w, png.h, png.ch]).toEqual([w, h, alpha ? 4 : 3]);
        for (let i = 0; i < w * h; i++)
          for (let c = 0; c < png.ch; c++) expect(png.data[i * png.ch + c]).toBe(img[i * 4 + c]);
      });
});

describe('JPEG encoder', () => {
  it('writes a well-formed baseline JPEG without metadata', () => {
    const w = 37;
    const h = 21;
    const enc = new JpegEncoder(w, h, 92);
    enc.addRows(testImage(w, h, false), h);
    const b = concat(enc.finish());
    expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
    expect([b[b.length - 2], b[b.length - 1]]).toEqual([0xff, 0xd9]);
    // APP1(EXIF) は書き込まない
    let hasExif = false;
    for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xe1) hasExif = true;
    expect(hasExif).toBe(false);
    // SOF0 に正しいサイズ
    let sof = -1;
    for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xc0) { sof = i; break; }
    expect((b[sof + 5] << 8) | b[sof + 6]).toBe(h);
    expect((b[sof + 7] << 8) | b[sof + 8]).toBe(w);
  });
  it('rejects missing rows', () => {
    const enc = new JpegEncoder(16, 32, 90);
    enc.addRows(testImage(16, 16, false), 16);
    expect(() => enc.finish()).toThrow();
  });
});

describe('file name', () => {
  it('appends _edited', () => {
    expect(editedFileName('IMG_0001.HEIC', 'jpeg')).toBe('IMG_0001_edited.jpg');
    expect(editedFileName('a.b.png', 'png')).toBe('a.b_edited.png');
    expect(editedFileName('noext', 'jpeg')).toBe('noext_edited.jpg');
  });
});
