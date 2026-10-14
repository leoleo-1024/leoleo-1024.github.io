/**
 * 編集データモデル。
 * 描画ライブラリ（Konva 等）に依存しない純粋な型として定義し、
 * 将来のネイティブ実装や別レンダラーでもそのまま使えるようにする。
 *
 * 座標はすべて「キャンバス座標（出力ピクセル）」で、画面サイズに依存しない。
 */

export const SCHEMA_VERSION = 1;

export type LayoutMode = 'free' | 'grid' | 'mosaic';

/** 元画像に対する正規化座標（0〜1）での切り抜き範囲 */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 枠の中での画像の見え方（表示範囲）。
 * crop はこの値と枠の縦横比から算出される派生値。
 */
export interface Fit {
  /** 1 = 枠を覆う最小倍率（cover）。大きいほど拡大 */
  zoom: number;
  /** 表示中心（元画像に対する正規化座標） */
  focusX: number;
  focusY: number;
}

export interface ImageLayer {
  id: string;
  assetId: string;
  /** 画像中心の X 座標（キャンバス座標） */
  x: number;
  /** 画像中心の Y 座標（キャンバス座標） */
  y: number;
  /** 表示幅（キャンバス座標） */
  width: number;
  /** 表示高さ（キャンバス座標） */
  height: number;
  /** 回転（度・時計回り・中心基準） */
  rotation: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  crop: Crop;
  fit: Fit;
  /** 角丸半径（キャンバス座標） */
  borderRadius: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

export type Background =
  | { type: 'color'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'transparent' }
  | { type: 'image'; assetId: string; fit: Fit; color: string };

export interface GridSettings {
  /** true の場合は枚数から行列を自動決定 */
  auto: boolean;
  rows: number;
  cols: number;
  /** 画像間余白（キャンバス座標） */
  gap: number;
  /** 外周余白（キャンバス座標） */
  padding: number;
}

export interface MosaicSettings {
  seed: number;
  gap: number;
  padding: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  presetId: string;
  canvasWidth: number;
  canvasHeight: number;
  background: Background;
  layoutMode: LayoutMode;
  grid: GridSettings;
  mosaic: MosaicSettings;
  /** 追加順を保持した画像アセット ID の配列 */
  assetIds: string[];
  imageLayers: ImageLayer[];
}

export interface ImageAsset {
  id: string;
  projectId: string;
  /** 書き出しに使う元画像（極端に大きい場合は長辺 4096px に縮小済み） */
  blob: Blob;
  mimeType: string;
  /** 向き補正後の元画像サイズ */
  originalWidth: number;
  originalHeight: number;
  /** blob の実サイズ */
  width: number;
  height: number;
  /** 編集画面用の縮小画像 */
  previewBlob: Blob;
  /** 一覧用サムネイル */
  thumbBlob: Blob;
  name: string;
  createdAt: number;
}

/** 編集履歴（Undo/Redo）の対象となる、プロジェクトの編集可能な部分 */
export type ProjectDoc = Pick<
  Project,
  | 'presetId'
  | 'canvasWidth'
  | 'canvasHeight'
  | 'background'
  | 'layoutMode'
  | 'grid'
  | 'mosaic'
  | 'assetIds'
  | 'imageLayers'
>;
