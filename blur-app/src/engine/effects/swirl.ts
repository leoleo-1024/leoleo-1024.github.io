/**
 * 渦巻き（Swirl / Twirl）。出力画素ごとに逆写像で元の位置を求め、バイリニア補間で取得する。
 * 回転角は中心で最大、外周で 0（(1-ρ)² で滑らかに減衰）なので、効果範囲の境界に切れ目が出ない。
 * 座標の計算はすべて元画像座標で行うため、プレビューと書き出しで中心・角度・半径が一致する。
 */
import { SWIRL_DAB_SPACING, SWIRL_DRAG_ANGLE, swirlMaxAngle } from '../params';
import type { EffectOp, IRect } from '../types';

/** レベル座標（画素中心が整数）でのバイリニアサンプラー */
export interface Sampler {
  /** (x, y) の RGBA を out[o..o+3] に書き込む（範囲外は端の画素） */
  sample(x: number, y: number, out: Uint8ClampedArray, o: number): void;
}

/** 連続した RGBA 配列（全体）からのサンプラー */
export function arraySampler(data: Uint8ClampedArray, w: number, h: number): Sampler {
  const maxX = w - 1;
  const maxY = h - 1;
  return {
    sample(x, y, out, o) {
      x = x < 0 ? 0 : x > maxX ? maxX : x;
      y = y < 0 ? 0 : y > maxY ? maxY : y;
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const a00 = data[i00 + 3] * w00;
      const a10 = data[i10 + 3] * w10;
      const a01 = data[i01 + 3] * w01;
      const a11 = data[i11 + 3] * w11;
      const a = a00 + a10 + a01 + a11;
      if (a <= 0) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        return;
      }
      out[o] = (data[i00] * a00 + data[i10] * a10 + data[i01] * a01 + data[i11] * a11) / a;
      out[o + 1] = (data[i00 + 1] * a00 + data[i10 + 1] * a10 + data[i01 + 1] * a01 + data[i11 + 1] * a11) / a;
      out[o + 2] = (data[i00 + 2] * a00 + data[i10 + 2] * a10 + data[i01 + 2] * a01 + data[i11 + 2] * a11) / a;
      out[o + 3] = a;
    },
  };
}

// ---- 範囲選択（四角形・楕円形）の渦巻き ----

export interface SwirlEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** 範囲選択から渦の中心・作用半径を決める（四角形は内接楕円を作用範囲とする） */
export function swirlEllipseOf(op: EffectOp): SwirlEllipse | null {
  const s = op.shape;
  if (s.type === 'rect') return { cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2 };
  if (s.type === 'ellipse') return { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry };
  return null;
}

/** 回転方向の符号：画像座標は Y 軸下向きなので、正の角度が画面上の時計回り */
export function swirlSign(op: EffectOp): number {
  return op.params.swirlDirection === 'ccw' ? -1 : 1;
}

/** 楕円の正規化座標で回転する逆写像（元画像座標）。外側はそのまま */
export function swirlEllipseInverse(e: SwirlEllipse, theta: number, px: number, py: number): [number, number] {
  const u = (px - e.cx) / e.rx;
  const v = (py - e.cy) / e.ry;
  const rho2 = u * u + v * v;
  if (rho2 >= 1) return [px, py];
  const k = 1 - Math.sqrt(rho2);
  const ang = theta * k * k;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  // 出力位置を -ang 回転した位置の画素を持ってくる → 内容は +ang 回転する
  const u2 = c * u + s * v;
  const v2 = -s * u + c * v;
  return [e.cx + u2 * e.rx, e.cy + v2 * e.ry];
}

// ---- ブラシの渦巻き ----

interface Dabs {
  nPoints: number;
  radius: number;
  xs: Float64Array;
  ys: Float64Array;
  angle: number; // 打点1つあたりの最大回転角（符号付き）
  cell: number;
  gx0: number;
  gy0: number;
  gw: number;
  gh: number;
  grid: Int32Array[]; // セルごとの打点番号（昇順）
}

const dabCache = new WeakMap<EffectOp, Dabs>();

/** 折れ線を一定間隔の打点に変換する（高速に指を動かしても間隔は一定） */
export function resampleDabs(points: number[], spacing: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [points[0]];
  const ys: number[] = [points[1]];
  let carry = 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const ax = points[i - 2];
    const ay = points[i - 1];
    const bx = points[i];
    const by = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= 0) continue;
    let t = spacing - carry;
    while (t <= len) {
      xs.push(ax + ((bx - ax) * t) / len);
      ys.push(ay + ((by - ay) * t) / len);
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  return { xs, ys };
}

export function brushDabs(op: EffectOp): Dabs {
  const shape = op.shape;
  if (shape.type !== 'brush') throw new Error('brush only');
  const cached = dabCache.get(op);
  if (cached && cached.nPoints === shape.points.length && cached.radius === shape.radius) return cached;
  const r = shape.radius;
  const spacing = Math.max(0.5, r * SWIRL_DAB_SPACING);
  const { xs, ys } = resampleDabs(shape.points, spacing);
  const n = xs.length;
  const theta = swirlMaxAngle(op.params.strength) * swirlSign(op);
  // 打点が1つ（タップ）のときは最大角、なぞったときは打点の重なりで合計がおおむね最大角になるよう分配
  const angle = n === 1 ? theta : theta * SWIRL_DRAG_ANGLE;
  const cell = Math.max(1, r * 2);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, xs[i] - r);
    y0 = Math.min(y0, ys[i] - r);
    x1 = Math.max(x1, xs[i] + r);
    y1 = Math.max(y1, ys[i] + r);
  }
  const gw = Math.max(1, Math.ceil((x1 - x0) / cell));
  const gh = Math.max(1, Math.ceil((y1 - y0) / cell));
  const lists: number[][] = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < n; i++) {
    const cx0 = Math.max(0, Math.floor((xs[i] - r - x0) / cell));
    const cy0 = Math.max(0, Math.floor((ys[i] - r - y0) / cell));
    const cx1 = Math.min(gw - 1, Math.floor((xs[i] + r - x0) / cell));
    const cy1 = Math.min(gh - 1, Math.floor((ys[i] + r - y0) / cell));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) lists[cy * gw + cx].push(i);
  }
  const d: Dabs = {
    nPoints: shape.points.length,
    radius: r,
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    angle,
    cell,
    gx0: x0,
    gy0: y0,
    gw,
    gh,
    grid: lists.map((l) => Int32Array.from(l)),
  };
  dabCache.set(op, d);
  return d;
}

/**
 * ブラシの渦巻きの逆写像。打点を新しい順にたどり、各打点の回転を逆にかけていく。
 * 回転は打点の中心まわりなので、点は常にその打点の円内にとどまる。
 */
export function brushSwirlInverse(d: Dabs, px: number, py: number): [number, number] {
  const r = d.radius;
  const r2 = r * r;
  let idx = d.xs.length;
  let x = px;
  let y = py;
  for (let guard = 0; guard < 4096; guard++) {
    const cx = Math.floor((x - d.gx0) / d.cell);
    const cy = Math.floor((y - d.gy0) / d.cell);
    if (cx < 0 || cy < 0 || cx >= d.gw || cy >= d.gh) break;
    const list = d.grid[cy * d.gw + cx];
    let found = -1;
    let dx = 0;
    let dy = 0;
    let dd = 0;
    for (let k = list.length - 1; k >= 0; k--) {
      const j = list[k];
      if (j >= idx) continue;
      dx = x - d.xs[j];
      dy = y - d.ys[j];
      dd = dx * dx + dy * dy;
      if (dd < r2) {
        found = j;
        break;
      }
    }
    if (found < 0) break;
    const k = 1 - Math.sqrt(dd) / r;
    const ang = d.angle * k * k;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    x = d.xs[found] + c * dx + s * dy;
    y = d.ys[found] - s * dx + c * dy;
    idx = found;
  }
  return [x, y];
}

/**
 * 渦巻きの結果を出力矩形 rect（レベル座標）について計算する。
 * f: レベルの縮小率、sampler: 参照する画像（同じレベル）
 */
export function swirlRegion(op: EffectOp, f: number, rect: IRect, sampler: Sampler): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const inv = 1 / f;
  if (op.shape.type === 'brush') {
    const d = brushDabs(op);
    for (let y = 0; y < rect.h; y++) {
      const py = (rect.y + y + 0.5) * f;
      for (let x = 0; x < rect.w; x++) {
        const px = (rect.x + x + 0.5) * f;
        const [sx, sy] = brushSwirlInverse(d, px, py);
        sampler.sample(sx * inv - 0.5, sy * inv - 0.5, out, (y * rect.w + x) * 4);
      }
    }
    return out;
  }
  const e = swirlEllipseOf(op)!;
  const theta = swirlMaxAngle(op.params.strength) * swirlSign(op);
  for (let y = 0; y < rect.h; y++) {
    const py = (rect.y + y + 0.5) * f;
    for (let x = 0; x < rect.w; x++) {
      const px = (rect.x + x + 0.5) * f;
      const [sx, sy] = swirlEllipseInverse(e, theta, px, py);
      sampler.sample(sx * inv - 0.5, sy * inv - 0.5, out, (y * rect.w + x) * 4);
    }
  }
  return out;
}
