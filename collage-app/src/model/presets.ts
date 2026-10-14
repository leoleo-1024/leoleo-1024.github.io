export interface CanvasPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  note?: string;
}

/**
 * 壁紙サイズのプリセット。
 * 機種を追加する場合はここに追記するだけでよい。
 */
export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', width: 1179, height: 2556, note: '1179 × 2556' },
  { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', width: 1290, height: 2796, note: '1290 × 2796' },
  { id: 'iphone-se', label: 'iPhone SE (第3世代)', width: 750, height: 1334, note: '750 × 1334' },
  { id: 'ratio-9-16', label: '9:16', width: 1440, height: 2560, note: '1440 × 2560' },
  { id: 'ratio-9-19.5', label: '9:19.5', width: 1170, height: 2535, note: '1170 × 2535' },
];

export const DEFAULT_PRESET = CANVAS_PRESETS[0];
export const CUSTOM_PRESET_ID = 'custom';

/** iOS Safari の canvas 上限（約 16.7M ピクセル）に合わせた最大面積 */
export const MAX_CANVAS_AREA = 16_777_216;
export const MAX_CANVAS_SIDE = 8192;
export const MIN_CANVAS_SIDE = 100;

export function validateCanvasSize(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return '数値を入力してください';
  if (width < MIN_CANVAS_SIDE || height < MIN_CANVAS_SIDE) return `幅・高さは${MIN_CANVAS_SIDE}px以上にしてください`;
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) return `幅・高さは${MAX_CANVAS_SIDE}px以下にしてください`;
  if (width * height > MAX_CANVAS_AREA) return 'サイズが大きすぎます（iPhoneのブラウザで描画できる上限を超えています）';
  return null;
}

export function presetLabel(presetId: string, width: number, height: number): string {
  const p = CANVAS_PRESETS.find((x) => x.id === presetId);
  return p ? `${p.label}（${width} × ${height}）` : `カスタム（${width} × ${height}）`;
}
