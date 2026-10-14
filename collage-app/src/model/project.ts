import { uid } from '../lib/id';
import { DEFAULT_PRESET } from './presets';
import { SCHEMA_VERSION, type Project, type ProjectDoc } from './types';

export function defaultProjectName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `壁紙 ${date.getMonth() + 1}/${date.getDate()} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function createProject(name = defaultProjectName()): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    presetId: DEFAULT_PRESET.id,
    canvasWidth: DEFAULT_PRESET.width,
    canvasHeight: DEFAULT_PRESET.height,
    background: { type: 'color', color: '#1c1c1e' },
    layoutMode: 'free',
    grid: { auto: true, rows: 3, cols: 2, gap: 24, padding: 48 },
    mosaic: { seed: 1, gap: 24, padding: 48 },
    assetIds: [],
    imageLayers: [],
  };
}

export function docOf(p: Project): ProjectDoc {
  return {
    presetId: p.presetId,
    canvasWidth: p.canvasWidth,
    canvasHeight: p.canvasHeight,
    background: p.background,
    layoutMode: p.layoutMode,
    grid: p.grid,
    mosaic: p.mosaic,
    assetIds: p.assetIds,
    imageLayers: p.imageLayers,
  };
}

/** 古いスキーマのプロジェクトを現在の形式へ移行する（将来の拡張用） */
export function migrateProject(p: Project): Project {
  if (!p.schemaVersion || p.schemaVersion < SCHEMA_VERSION) {
    return { ...p, schemaVersion: SCHEMA_VERSION };
  }
  return p;
}
