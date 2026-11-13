import type { ReactNode } from 'react';
import { STRENGTH_MAX, STRENGTH_MIN } from '../engine/params';
import type { EffectType } from '../engine/types';
import { setParams, store, useStore, type Tool } from '../state/store';
import { Icon } from './icons';

const EFFECTS: Array<{ id: EffectType; label: string; icon: () => ReactNode }> = [
  { id: 'gaussianBlur', label: 'ぼかし', icon: Icon.gaussianBlur },
  { id: 'pixelate', label: 'モザイク', icon: Icon.pixelate },
  { id: 'blackout', label: '黒塗り', icon: Icon.blackout },
  { id: 'swirl', label: '渦巻き', icon: Icon.swirl },
  { id: 'motionBlur', label: 'モーション', icon: Icon.motionBlur },
];

const TOOLS: Array<{ id: Tool; label: string; icon: () => ReactNode }> = [
  { id: 'brush', label: 'ブラシ', icon: Icon.brush },
  { id: 'rect', label: '四角', icon: Icon.rect },
  { id: 'ellipse', label: '楕円', icon: Icon.ellipse },
  { id: 'eraser', label: '消しゴム', icon: Icon.eraser },
  { id: 'move', label: '移動', icon: Icon.move },
];

export const SIZE_MIN = 8;
export const SIZE_MAX = 160;

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (v: number) => void;
  onActive?: (active: boolean) => void;
  testId: string;
}) {
  const { label, value, min, max, step = 1, display, onChange, onActive, testId } = props;
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => onActive?.(true)}
        onPointerUp={() => onActive?.(false)}
        onPointerCancel={() => onActive?.(false)}
        onBlur={() => onActive?.(false)}
      />
      <span className="slider-value">{display ?? value}</span>
    </label>
  );
}

function Settings() {
  const tool = useStore((s) => s.tool);
  const effect = useStore((s) => s.effect);
  const params = useStore((s) => s.params[s.effect]);
  const brushSize = useStore((s) => s.brushSize);
  const eraserSize = useStore((s) => s.eraserSize);
  const pending = useStore((s) => s.pending);
  const setPreview = (v: boolean) => store.set({ sizePreview: v });

  if (tool === 'move') return <div className="hint">1本指で写真を移動、2本指で拡大・縮小できます。</div>;
  if (tool === 'eraser')
    return (
      <div className="settings">
        <Slider label="サイズ" value={eraserSize} min={SIZE_MIN} max={SIZE_MAX} onChange={(v) => store.set({ eraserSize: v })} onActive={setPreview} testId="size" />
        <div className="hint small">なぞった部分の加工を消して元の写真に戻します。</div>
      </div>
    );
  const isShape = tool === 'rect' || tool === 'ellipse';
  return (
    <div className="settings">
      {!isShape && (
        <Slider label="サイズ" value={brushSize} min={SIZE_MIN} max={SIZE_MAX} onChange={(v) => store.set({ brushSize: v })} onActive={setPreview} testId="size" />
      )}
      {effect !== 'blackout' && (
        <Slider label="強さ" value={params.strength} min={STRENGTH_MIN} max={STRENGTH_MAX} onChange={(v) => setParams(effect, { strength: v })} testId="strength" />
      )}
      {effect === 'swirl' && (
        <div className="slider-row">
          <span className="slider-label">方向</span>
          <div className="segmented" role="radiogroup" aria-label="回転方向">
            {(['cw', 'ccw'] as const).map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={params.swirlDirection === d}
                className={params.swirlDirection === d ? 'is-on' : ''}
                onClick={() => setParams('swirl', { swirlDirection: d })}
                data-testid={`dir-${d}`}
              >
                {d === 'cw' ? <Icon.cw /> : <Icon.ccw />}
                {d === 'cw' ? '時計回り' : '反時計回り'}
              </button>
            ))}
          </div>
        </div>
      )}
      {effect === 'motionBlur' && (
        <Slider label="角度" value={params.angle} min={0} max={359} display={`${params.angle}°`} onChange={(v) => setParams('motionBlur', { angle: v })} testId="angle" />
      )}
      {isShape && !pending && <div className="hint small">ドラッグで範囲を指定します。</div>}
      {effect === 'blackout' && !isShape && <div className="hint small">選んだ部分を完全な黒で塗りつぶします。</div>}
    </div>
  );
}

export function BottomPanel() {
  const effect = useStore((s) => s.effect);
  const tool = useStore((s) => s.tool);
  const effectActive = tool !== 'eraser' && tool !== 'move';
  return (
    <footer className="bottom">
      <Settings />
      <nav className="row scroll-x" aria-label="加工効果">
        {EFFECTS.map((e) => (
          <button
            key={e.id}
            className={`tool-btn ${effect === e.id ? (effectActive ? 'is-on' : 'is-dim-on') : ''}`}
            aria-pressed={effect === e.id}
            data-testid={`effect-${e.id}`}
            onClick={() => store.set({ effect: e.id, tool: effectActive ? tool : 'brush' })}
          >
            <e.icon />
            <span>{e.label}</span>
          </button>
        ))}
      </nav>
      <nav className="row tools" aria-label="加工方法">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn small ${tool === t.id ? 'is-on' : ''}`}
            aria-pressed={tool === t.id}
            data-testid={`tool-${t.id}`}
            onClick={() => store.set({ tool: t.id })}
          >
            <t.icon />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </footer>
  );
}
