import { containSize, coverCrop, DEFAULT_FIT, type Rect, type Size } from './geometry';
import type { GridSettings, ImageLayer, MosaicSettings, ProjectDoc } from './types';

export type AssetSizeMap = Record<string, Size>;

/** 再現可能な疑似乱数（mulberry32） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 枚数とキャンバス比率から、セルが正方形に近くなる行数・列数を決める */
export function autoGridDims(n: number, canvas: Size): { rows: number; cols: number } {
  if (n <= 1) return { rows: 1, cols: 1 };
  const aspect = canvas.width / canvas.height;
  let best = { rows: n, cols: 1, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellAspect = (aspect * rows) / cols;
    const empty = rows * cols - n;
    const score = Math.abs(Math.log(cellAspect)) + empty * 0.35;
    if (score < best.score) best = { rows, cols, score };
  }
  return { rows: best.rows, cols: best.cols };
}

/**
 * 外周余白 padding、セル間余白 gap になるよう矩形群を配置するための補助。
 * 全体を (padding - gap/2) で内側に寄せた領域で分割し、各セルを gap/2 ずつ縮める。
 */
function outerBox(canvas: Size, padding: number, gap: number): Rect {
  const inset = padding - gap / 2;
  return { x: inset, y: inset, width: canvas.width - inset * 2, height: canvas.height - inset * 2 };
}

function shrink(r: Rect, gap: number): Rect {
  const g = gap / 2;
  return { x: r.x + g, y: r.y + g, width: Math.max(1, r.width - gap), height: Math.max(1, r.height - gap) };
}

export function gridRects(n: number, settings: GridSettings, canvas: Size): { rects: Rect[]; rows: number; cols: number } {
  const dims = settings.auto ? autoGridDims(n, canvas) : { rows: settings.rows, cols: settings.cols };
  const rows = Math.max(1, dims.rows);
  const cols = Math.max(1, dims.cols);
  const box = outerBox(canvas, settings.padding, settings.gap);
  const cw = box.width / cols;
  const ch = box.height / rows;
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push(shrink({ x: box.x + c * cw, y: box.y + r * ch, width: cw, height: ch }, settings.gap));
    }
  }
  return { rects, rows, cols };
}

/**
 * モザイク（大小のセルの組み合わせ）を生成する。
 * 面積の大きいセルを繰り返し 2 分割するギロチン分割で、seed により結果が変わる。
 */
export function mosaicRects(n: number, settings: Pick<MosaicSettings, 'seed' | 'gap' | 'padding'>, canvas: Size): Rect[] {
  const rand = seededRandom(settings.seed);
  const box = outerBox(canvas, settings.padding, settings.gap);
  const rects: Rect[] = [box];
  const count = Math.max(1, n);
  while (rects.length < count) {
    // 大きいものほど選ばれやすくしつつ、ランダム性を持たせる
    const order = rects
      .map((r, i) => ({ i, score: r.width * r.height * (0.6 + rand() * 0.8) }))
      .sort((a, b) => b.score - a.score);
    const idx = order[0].i;
    const r = rects[idx];
    const aspect = r.width / r.height;
    // 縦長のセルは横線で、横長のセルは縦線で分割しやすくする
    const splitHorizontal = aspect < 0.75 ? rand() < 0.85 : aspect > 1.3 ? rand() < 0.15 : rand() < 0.5;
    const ratio = 0.35 + rand() * 0.3;
    let a: Rect;
    let b: Rect;
    if (splitHorizontal) {
      const h = r.height * ratio;
      a = { x: r.x, y: r.y, width: r.width, height: h };
      b = { x: r.x, y: r.y + h, width: r.width, height: r.height - h };
    } else {
      const w = r.width * ratio;
      a = { x: r.x, y: r.y, width: w, height: r.height };
      b = { x: r.x + w, y: r.y, width: r.width - w, height: r.height };
    }
    rects.splice(idx, 1, a, b);
  }
  // 上から下・左から右の読み順に並べる
  return rects
    .sort((p, q) => (Math.abs(p.y - q.y) > 1 ? p.y - q.y : p.x - q.x))
    .map((r) => shrink(r, settings.gap));
}

/** レイヤーを矩形にはめ込む（枠を覆うように切り抜き、表示範囲 fit は維持） */
export function fitLayerToRect(layer: ImageLayer, rect: Rect, asset: Size): ImageLayer {
  const frame = { width: rect.width, height: rect.height };
  const { crop, fit } = coverCrop(asset, frame, layer.fit);
  return {
    ...layer,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    crop,
    fit,
    visible: true,
  };
}

/** zIndex 順に並べ替え、zIndex を 0.. の連番に振り直す */
export function normalizeLayers(layers: ImageLayer[]): ImageLayer[] {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex).map((l, i) => (l.zIndex === i ? l : { ...l, zIndex: i }));
}

/**
 * 現在のレイアウトモードに従ってレイヤーを再配置する。
 * フリーモードでは何もしない（ユーザーの配置を尊重）。
 */
export function applyLayout(doc: ProjectDoc, assets: AssetSizeMap): ProjectDoc {
  const canvas = { width: doc.canvasWidth, height: doc.canvasHeight };
  const layers = normalizeLayers(doc.imageLayers);
  if (doc.layoutMode === 'free') return { ...doc, imageLayers: layers };

  let rects: Rect[];
  let grid = doc.grid;
  if (doc.layoutMode === 'grid') {
    const g = gridRects(layers.length, doc.grid, canvas);
    rects = g.rects;
    grid = { ...doc.grid, rows: g.rows, cols: g.cols };
  } else {
    rects = mosaicRects(layers.length, doc.mosaic, canvas);
  }

  const imageLayers = layers.map((layer, i) => {
    const asset = assets[layer.assetId];
    const rect = rects[i];
    if (!asset) return layer;
    // グリッドのセル数より画像が多い場合、あふれた画像は非表示
    if (!rect) return { ...layer, visible: false };
    return fitLayerToRect(layer, rect, asset);
  });
  return { ...doc, grid, imageLayers };
}

/**
 * フリーモードで新しく追加した画像の初期配置。
 * 枚数に応じたグリッドの各セルに、縦横比を保って収める。
 */
export function initialFreePlacement(count: number, canvas: Size, aspect: (i: number) => number): Rect[] {
  const padding = Math.round(canvas.width * 0.06);
  const gap = Math.round(canvas.width * 0.03);
  const { rects } = gridRects(count, { auto: true, rows: 1, cols: 1, gap, padding }, canvas);
  return rects.slice(0, count).map((cell, i) => {
    const size = containSize(aspect(i), cell, count === 1 ? 0.85 : 0.95);
    return {
      x: cell.x + (cell.width - size.width) / 2,
      y: cell.y + (cell.height - size.height) / 2,
      width: size.width,
      height: size.height,
    };
  });
}

export function makeLayer(id: string, assetId: string, rect: Rect, zIndex: number): ImageLayer {
  return {
    id,
    assetId,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fit: { ...DEFAULT_FIT },
    borderRadius: 0,
    zIndex,
    visible: true,
    locked: false,
  };
}
