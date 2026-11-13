/**
 * 表示座標（CSS px、編集エリアの左上が原点）と元画像座標の変換。
 * screen = image * scale + (tx, ty)
 */
export const MAX_ZOOM = 8;

export class ViewTransform {
  scale = 1;
  tx = 0;
  ty = 0;
  cw = 1;
  ch = 1;
  iw = 1;
  ih = 1;

  setViewport(cw: number, ch: number): void {
    const keep = this.cw > 1 && this.iw > 1;
    const cx = this.cw / 2;
    const cy = this.ch / 2;
    const [ix, iy] = this.toImage(cx, cy);
    const zoom = this.zoom;
    this.cw = Math.max(1, cw);
    this.ch = Math.max(1, ch);
    if (keep) {
      this.scale = this.fitScale * zoom;
      this.tx = this.cw / 2 - ix * this.scale;
      this.ty = this.ch / 2 - iy * this.scale;
      this.clamp();
    } else this.reset();
  }

  setImage(iw: number, ih: number): void {
    this.iw = iw;
    this.ih = ih;
    this.reset();
  }

  get fitScale(): number {
    return Math.min(this.cw / this.iw, this.ch / this.ih);
  }

  /** 全体表示に対する拡大率（1 = 全体表示） */
  get zoom(): number {
    return this.scale / this.fitScale;
  }

  reset(): void {
    this.scale = this.fitScale;
    this.tx = (this.cw - this.iw * this.scale) / 2;
    this.ty = (this.ch - this.ih * this.scale) / 2;
  }

  toImage(sx: number, sy: number): [number, number] {
    return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale];
  }

  toScreen(ix: number, iy: number): [number, number] {
    return [ix * this.scale + this.tx, iy * this.scale + this.ty];
  }

  /** 画面上の点 (sx, sy) の下にある画像の位置を保ったまま拡大率を変える */
  zoomAt(sx: number, sy: number, newScale: number): void {
    const [ix, iy] = this.toImage(sx, sy);
    this.scale = this.clampScale(newScale);
    this.tx = sx - ix * this.scale;
    this.ty = sy - iy * this.scale;
    this.clamp();
  }

  /**
   * ピンチ：開始時に指の中点の下にあった画像上の点 (ix, iy) が、現在の中点 (sx, sy) に来るようにする
   */
  pinch(ix: number, iy: number, sx: number, sy: number, newScale: number): void {
    this.scale = this.clampScale(newScale);
    this.tx = sx - ix * this.scale;
    this.ty = sy - iy * this.scale;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.clamp();
  }

  clampScale(s: number): number {
    const fit = this.fitScale;
    return Math.min(fit * MAX_ZOOM, Math.max(fit, s));
  }

  /** 画像が編集エリアより小さい軸は中央に、大きい軸は端が内側に入り込まないように */
  clamp(): void {
    const w = this.iw * this.scale;
    const h = this.ih * this.scale;
    if (w <= this.cw) this.tx = (this.cw - w) / 2;
    else this.tx = Math.min(0, Math.max(this.cw - w, this.tx));
    if (h <= this.ch) this.ty = (this.ch - h) / 2;
    else this.ty = Math.min(0, Math.max(this.ch - h, this.ty));
  }

  /** 表示中の画像範囲（元画像座標、画像内に切り詰め） */
  visibleImageRect(): { x0: number; y0: number; x1: number; y1: number } {
    const [x0, y0] = this.toImage(0, 0);
    const [x1, y1] = this.toImage(this.cw, this.ch);
    return {
      x0: Math.max(0, x0),
      y0: Math.max(0, y0),
      x1: Math.min(this.iw, x1),
      y1: Math.min(this.ih, y1),
    };
  }
}
