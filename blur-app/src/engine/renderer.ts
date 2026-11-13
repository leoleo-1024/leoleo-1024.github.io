/**
 * 合成エンジン。元画像（ピラミッド）と操作列から、任意のレベル・任意の矩形の加工結果を計算する。
 *
 * 合成ルール（画素ごと）:
 *   c = 元画像
 *   操作を古い順に: 効果 → c = lerp(c, 効果画像, マスク) / 消しゴム → c = lerp(c, 元画像, マスク)
 *
 * 効果画像は「元画像」から計算する。ただし黒塗りより後の効果は、黒塗り済み（消しゴムも反映）の
 * 画像を元にする（=「基準画像のバージョン」）。これにより、黒塗りした上からぼかし等を重ねても、
 * 隠した画素がにじみ出ることはない。
 *
 * 途中結果はタイル単位でキャッシュする（マスク・基準画像・効果画像）。操作 ID は不変なので、
 * Undo/Redo してもキャッシュはそのまま使える。
 */
import { TileCache } from './cache';
import { gaussianBlurInPlace, gaussianMargin } from './effects/gaussian';
import { motionBlur, motionMargin } from './effects/motion';
import { pixelate, pixelateSourceRect } from './effects/pixelate';
import { arraySampler, swirlRegion, type Sampler } from './effects/swirl';
import { opBoundsAtLevel, rasterizeMask } from './mask';
import { gaussianSigma, globalEffectKey, motionLength, pixelBlockSize } from './params';
import { blendMasked, fromPremultFloat, readLevel, gather, toPremultFloat } from './pixels';
import { clampToSize, inflate, intersect, isEmpty } from './rect';
import type { EffectOp, IRect, Level, Op } from './types';

/** マスク・基準画像・渦巻きのタイルの大きさ（レベルpx） */
export const TILE = 256;

interface Ctx {
  ops: Op[];
  /** ops[k] の効果が参照する基準画像のバージョン（0 = 元画像） */
  vers: number[];
  indexOf: Map<number, number>;
}

function tileRange(r: IRect, t: number) {
  return {
    tx0: Math.floor(r.x / t),
    ty0: Math.floor(r.y / t),
    tx1: Math.floor((r.x + r.w - 1) / t),
    ty1: Math.floor((r.y + r.h - 1) / t),
  };
}

function crop<T extends Uint8Array | Uint8ClampedArray>(data: T, from: IRect, sub: IRect, ch: number, make: (n: number) => T): T {
  if (from.x === sub.x && from.y === sub.y && from.w === sub.w && from.h === sub.h) return data;
  const out = make(sub.w * sub.h * ch);
  for (let y = 0; y < sub.h; y++) {
    const s = ((sub.y - from.y + y) * from.w + (sub.x - from.x)) * ch;
    out.set(data.subarray(s, s + sub.w * ch), y * sub.w * ch);
  }
  return out;
}

export class Renderer {
  readonly levels: Level[];
  /** 元画像の長辺（効果の強さの基準） */
  readonly D: number;
  readonly cache: TileCache;

  constructor(levels: Level[], cacheBytes = 160 * 1024 * 1024) {
    this.levels = levels;
    this.D = Math.max(levels[0].w, levels[0].h);
    this.cache = new TileCache(cacheBytes);
  }

  get width() {
    return this.levels[0].w;
  }
  get height() {
    return this.levels[0].h;
  }

  private context(ops: Op[]): Ctx {
    const vers: number[] = [];
    const indexOf = new Map<number, number>();
    let ver = 0;
    let hasBlack = false;
    ops.forEach((op, k) => {
      vers.push(ver);
      indexOf.set(op.id, k);
      if (op.kind === 'effect' && op.effect === 'blackout') {
        hasBlack = true;
        ver = op.id;
      } else if (op.kind === 'erase' && hasBlack) {
        ver = op.id;
      }
    });
    return { ops, vers, indexOf };
  }

  /** 操作の影響範囲（レベル座標） */
  opBounds(op: Op, li: number): IRect {
    const L = this.levels[li];
    return opBoundsAtLevel(op, L.f, L.w, L.h);
  }

  /**
   * レベル li の矩形 rect（レベル内に切り詰めること）の加工結果を計算する。
   * 戻り値は rect.w × rect.h の RGBA。
   */
  render(ops: Op[], li: number, rect: IRect): Uint8ClampedArray {
    const L = this.levels[li];
    rect = clampToSize(rect, L.w, L.h);
    const out = readLevel(L, rect);
    if (isEmpty(rect) || !ops.length) return out;
    const ctx = this.context(ops);
    ops.forEach((op, k) => {
      const r = intersect(this.opBounds(op, li), rect);
      if (isEmpty(r)) return;
      const { tx0, ty0, tx1, ty1 } = tileRange(r, TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const tileRect = this.tileRect(li, tx, ty, TILE);
          const sub = intersect(tileRect, r);
          if (isEmpty(sub)) continue;
          const mt = this.maskTile(op, li, tx, ty);
          if (!mt) continue;
          const m = crop(mt, tileRect, sub, 1, (n) => new Uint8Array(n));
          if (op.kind === 'erase') {
            blendMasked(out, readLevel(L, sub), m, rect.w, sub, rect);
          } else if (op.effect === 'blackout') {
            blendMasked(out, null, m, rect.w, sub, rect);
          } else {
            const e = this.effectRegion(ctx, op, ctx.vers[k], li, sub);
            blendMasked(out, e, m, rect.w, sub, rect);
          }
        }
      }
    });
    return out;
  }

  private tileRect(li: number, tx: number, ty: number, t: number): IRect {
    const L = this.levels[li];
    return clampToSize({ x: tx * t, y: ty * t, w: t, h: t }, L.w, L.h);
  }

  // ---- マスク ----

  /** マスクのタイル（null = 全く覆っていない） */
  maskTile(op: Op, li: number, tx: number, ty: number): Uint8Array | null {
    const key = `m|${op.id}|${li}|${tx}|${ty}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit as Uint8Array | null;
    const L = this.levels[li];
    const tr = this.tileRect(li, tx, ty, TILE);
    const b = intersect(this.opBounds(op, li), tr);
    let data: Uint8Array | null = null;
    if (!isEmpty(b)) {
      const m = rasterizeMask(op, L.f, tr);
      for (let i = 0; i < m.length; i++) {
        if (m[i]) {
          data = m;
          break;
        }
      }
    }
    this.cache.set(key, data);
    return data;
  }

  // ---- 基準画像（黒塗り・消しゴム反映済み） ----

  private baseTile(ctx: Ctx, ver: number, li: number, tx: number, ty: number): Uint8ClampedArray {
    const key = `b|${ver}|${li}|${tx}|${ty}`;
    const hit = this.cache.get(key);
    if (hit) return hit as Uint8ClampedArray;
    const L = this.levels[li];
    const tr = this.tileRect(li, tx, ty, TILE);
    const out = readLevel(L, tr);
    const last = ctx.indexOf.get(ver);
    if (last === undefined) throw new Error('unknown base version');
    let src: Uint8ClampedArray | null = null;
    for (let j = 0; j <= last; j++) {
      const op = ctx.ops[j];
      const isBlack = op.kind === 'effect' && op.effect === 'blackout';
      if (!isBlack && op.kind !== 'erase') continue;
      const m = this.maskTile(op, li, tx, ty);
      if (!m) continue;
      if (isBlack) blendMasked(out, null, m, tr.w, tr, tr);
      else blendMasked(out, (src ??= readLevel(L, tr)), m, tr.w, tr, tr);
    }
    this.cache.set(key, out);
    return out;
  }

  /** 基準画像の矩形（範囲外は clamp-to-edge） */
  private baseRead(ctx: Ctx, ver: number, li: number, rect: IRect): Uint8ClampedArray {
    const L = this.levels[li];
    if (ver === 0) return readLevel(L, rect);
    const out = new Uint8ClampedArray(rect.w * rect.h * 4);
    return gather(L.w, L.h, TILE, TILE, 4, (tx, ty) => this.baseTile(ctx, ver, li, tx, ty), rect, out);
  }

  private baseSampler(ctx: Ctx, ver: number, li: number): Sampler {
    const L = this.levels[li];
    if (ver === 0) return arraySampler(L.data, L.w, L.h);
    // タイルをまたぐ補間が必要なため、近傍 2×2 を含む小さな矩形をタイルから取り出して補間する
    const px = new Uint8ClampedArray(16);
    const tiny = arraySampler(px, 2, 2);
    let lastKey = -1;
    let lastTile: Uint8ClampedArray | null = null;
    const ntx = Math.ceil(L.w / TILE);
    const get = (x: number, y: number, o: number) => {
      const tx = (x / TILE) | 0;
      const ty = (y / TILE) | 0;
      const k = ty * ntx + tx;
      if (k !== lastKey) {
        lastTile = this.baseTile(ctx, ver, li, tx, ty);
        lastKey = k;
      }
      const tw = Math.min(TILE, L.w - tx * TILE);
      const i = ((y - ty * TILE) * tw + (x - tx * TILE)) * 4;
      px[o] = lastTile![i];
      px[o + 1] = lastTile![i + 1];
      px[o + 2] = lastTile![i + 2];
      px[o + 3] = lastTile![i + 3];
    };
    const maxX = L.w - 1;
    const maxY = L.h - 1;
    return {
      sample(x, y, out, o) {
        x = x < 0 ? 0 : x > maxX ? maxX : x;
        y = y < 0 ? 0 : y > maxY ? maxY : y;
        const x0 = x | 0;
        const y0 = y | 0;
        const x1 = x0 < maxX ? x0 + 1 : x0;
        const y1 = y0 < maxY ? y0 + 1 : y0;
        get(x0, y0, 0);
        get(x1, y0, 4);
        get(x0, y1, 8);
        get(x1, y1, 12);
        tiny.sample(x - x0, y - y0, out, o);
      },
    };
  }

  // ---- 効果画像 ----

  private effectRegion(ctx: Ctx, op: EffectOp, ver: number, li: number, rect: IRect): Uint8ClampedArray {
    const L = this.levels[li];
    if (op.effect === 'swirl') {
      const key = `s|${op.id}|${ver}|${li}|${Math.floor(rect.x / TILE)}|${Math.floor(rect.y / TILE)}`;
      // rect は TILE 境界内に収まっている（render から呼ばれる場合）
      const tr = this.tileRect(li, Math.floor(rect.x / TILE), Math.floor(rect.y / TILE), TILE);
      let data = this.cache.get(key) as Uint8ClampedArray | null | undefined;
      if (!data) {
        data = swirlRegion(op, L.f, tr, this.baseSampler(ctx, ver, li));
        this.cache.set(key, data);
      }
      return crop(data, tr, rect, 4, (n) => new Uint8ClampedArray(n));
    }
    const ek = globalEffectKey(op, this.D)!;
    const T = this.effectTileSize(op, li);
    const out = new Uint8ClampedArray(rect.w * rect.h * 4);
    return gather(L.w, L.h, T, T, 4, (tx, ty) => this.effectTile(ctx, op, ek, ver, li, tx, ty, T), rect, out);
  }

  private effectTileSize(op: EffectOp, li: number): number {
    const f = this.levels[li].f;
    let margin = 0;
    if (op.effect === 'motionBlur') {
      const m = motionMargin(motionLength(op.params.strength, this.D) / f, op.params.angle);
      margin = Math.max(m.mx, m.my);
    } else if (op.effect === 'pixelate') {
      margin = pixelBlockSize(op.params.strength, this.D) / f;
    }
    if (margin > 256) return 1024;
    if (margin > 80) return 512;
    return TILE;
  }

  private effectTile(ctx: Ctx, op: EffectOp, ek: string, ver: number, li: number, tx: number, ty: number, T: number): Uint8ClampedArray {
    const key = `e|${ek}|${ver}|${li}|${T}|${tx}|${ty}`;
    const hit = this.cache.get(key);
    if (hit) return hit as Uint8ClampedArray;
    const tr = this.tileRect(li, tx, ty, T);
    const data = this.computeEffect(ctx, op, ver, li, tr);
    this.cache.set(key, data);
    return data;
  }

  /** 全面に効果をかけた画像の矩形 tr（レベル内）を計算する */
  computeEffect(ctx: Ctx, op: EffectOp, ver: number, li: number, tr: IRect): Uint8ClampedArray {
    const L = this.levels[li];
    switch (op.effect) {
      case 'gaussianBlur': {
        const sigmaImg = gaussianSigma(op.params.strength, this.D);
        // ぼかしが大きいときは縮小レベルで計算して拡大する（結果は低周波なので見た目は同じ、計算量は激減）
        let lp = li;
        while (lp + 1 < this.levels.length && sigmaImg / this.levels[lp + 1].f >= 4) lp++;
        const sig = sigmaImg / this.levels[lp].f;
        const m = Math.ceil(gaussianMargin(sig));
        if (lp === li) {
          const region = inflate(tr, m);
          const buf = toPremultFloat(this.baseRead(ctx, ver, li, region));
          gaussianBlurInPlace(buf, region.w, region.h, sig);
          return fromPremultFloat(buf, region.w, { x: m, y: m, w: tr.w, h: tr.h });
        }
        const s = this.levels[lp].f / L.f;
        const fx0 = (tr.x + 0.5) / s - 0.5;
        const fy0 = (tr.y + 0.5) / s - 0.5;
        const fx1 = (tr.x + tr.w - 0.5) / s - 0.5;
        const fy1 = (tr.y + tr.h - 0.5) / s - 0.5;
        const cx0 = Math.floor(fx0);
        const cy0 = Math.floor(fy0);
        const coarse = { x: cx0, y: cy0, w: Math.floor(fx1) + 2 - cx0, h: Math.floor(fy1) + 2 - cy0 };
        const region = inflate(coarse, m);
        const buf = toPremultFloat(this.baseRead(ctx, ver, lp, region));
        gaussianBlurInPlace(buf, region.w, region.h, sig);
        const small = fromPremultFloat(buf, region.w, { x: m, y: m, w: coarse.w, h: coarse.h });
        const sampler = arraySampler(small, coarse.w, coarse.h);
        const out = new Uint8ClampedArray(tr.w * tr.h * 4);
        for (let y = 0; y < tr.h; y++) {
          const sy = (tr.y + y + 0.5) / s - 0.5 - coarse.y;
          for (let x = 0; x < tr.w; x++) {
            sampler.sample((tr.x + x + 0.5) / s - 0.5 - coarse.x, sy, out, (y * tr.w + x) * 4);
          }
        }
        return out;
      }
      case 'pixelate': {
        const bl = pixelBlockSize(op.params.strength, this.D) / L.f;
        const srcRect = pixelateSourceRect(tr, bl, L.w, L.h);
        return pixelate(this.baseRead(ctx, ver, li, srcRect), srcRect, tr, bl);
      }
      case 'motionBlur': {
        const len = motionLength(op.params.strength, this.D) / L.f;
        const { mx, my } = motionMargin(len, op.params.angle);
        const region = { x: tr.x - mx, y: tr.y - my, w: tr.w + 2 * mx, h: tr.h + 2 * my };
        const buf = toPremultFloat(this.baseRead(ctx, ver, li, region));
        const res = motionBlur(buf, region.w, region.h, len, op.params.angle);
        return fromPremultFloat(res, region.w, { x: mx, y: my, w: tr.w, h: tr.h });
      }
      default:
        throw new Error(`not a global effect: ${op.effect}`);
    }
  }

  // ---- キャッシュの無効化 ----

  /** 操作のマスク・渦巻きのキャッシュを、元画像座標の範囲 imgRect（省略時は全体）について破棄する */
  invalidateOp(op: Op, imgRect?: { x0: number; y0: number; x1: number; y1: number }): void {
    if (!imgRect) {
      this.cache.deletePrefix(`m|${op.id}|`);
      this.cache.deletePrefix(`s|${op.id}|`);
      return;
    }
    this.levels.forEach((L, li) => {
      const r = clampToSize(
        inflate(
          {
            x: Math.floor(imgRect.x0 / L.f),
            y: Math.floor(imgRect.y0 / L.f),
            w: Math.ceil(imgRect.x1 / L.f) - Math.floor(imgRect.x0 / L.f),
            h: Math.ceil(imgRect.y1 / L.f) - Math.floor(imgRect.y0 / L.f),
          },
          2,
        ),
        L.w,
        L.h,
      );
      if (isEmpty(r)) return;
      const { tx0, ty0, tx1, ty1 } = tileRange(r, TILE);
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          this.cache.delete(`m|${op.id}|${li}|${tx}|${ty}`);
        }
      // 渦巻きは基準画像のバージョンがキーに含まれるため前方一致で消す
      if (op.kind === 'effect' && op.effect === 'swirl') {
        for (let ty = ty0; ty <= ty1; ty++)
          for (let tx = tx0; tx <= tx1; tx++) {
            for (const k of this.swirlKeys(op.id, li, tx, ty)) this.cache.delete(k);
          }
      }
    });
  }

  private swirlKeys(id: number, li: number, tx: number, ty: number): string[] {
    const keys: string[] = [];
    const suffix = `|${li}|${tx}|${ty}`;
    // キャッシュの内部を直接は見られないので、候補のバージョンを列挙する代わりに前方一致で探す
    this.cache.forEachKey((k) => {
      if (k.startsWith(`s|${id}|`) && k.endsWith(suffix)) keys.push(k);
    });
    return keys;
  }

  dispose(): void {
    this.cache.clear();
  }
}
