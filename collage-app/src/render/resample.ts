/**
 * 高品質な縮小処理。
 * canvas の drawImage で一度に大きく縮小すると、ブラウザ（特に Safari）によっては
 * 補間が粗くなりジャギーやモアレが出る。1/2 ずつ段階的に縮小することで、
 * 面積平均に近い滑らかな結果を得る。
 *
 * メモリ：一時 canvas は常に 1〜2 枚だけ保持し、不要になった時点で解放する。
 * 最大でも「切り抜き範囲の 1/4 の面積」の canvas が 1 枚増える程度。
 */

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas の初期化に失敗しました');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

function free(c: HTMLCanvasElement | null) {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}

/** この倍率を超えて縮小する場合に段階縮小を行う */
export const STEP_DOWNSCALE_THRESHOLD = 2;

/**
 * src の (sx, sy, sw, sh) の範囲を tw × th ピクセルに縮小した canvas を返す。
 * 呼び出し側は使い終わったら width/height を 0 にして解放すること。
 */
export function downscaleRegion(
  src: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  tw: number,
  th: number,
): HTMLCanvasElement {
  tw = Math.max(1, Math.round(tw));
  th = Math.max(1, Math.round(th));
  let cur: CanvasImageSource = src;
  let curCanvas: HTMLCanvasElement | null = null;
  let x = sx;
  let y = sy;
  let w = sw;
  let h = sh;
  // 目標サイズの 2 倍を下回るまで 1/2 ずつ縮小
  while (w / 2 >= tw && h / 2 >= th) {
    const nw = Math.max(tw, Math.round(w / 2));
    const nh = Math.max(th, Math.round(h / 2));
    const { c, ctx } = makeCanvas(nw, nh);
    ctx.drawImage(cur, x, y, w, h, 0, 0, nw, nh);
    free(curCanvas);
    cur = curCanvas = c;
    x = 0;
    y = 0;
    w = nw;
    h = nh;
  }
  const { c, ctx } = makeCanvas(tw, th);
  ctx.drawImage(cur, x, y, w, h, 0, 0, tw, th);
  free(curCanvas);
  return c;
}
