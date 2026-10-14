import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { FilePicker, type FilePickerHandle } from '../../components/FilePicker';
import { Button, cx, Segmented, SliderRow } from '../../components/ui';
import { importImageFile, ImageImportError } from '../../lib/image';
import { DEFAULT_FIT, recomputeCrop } from '../../model/geometry';
import { autoGridDims, mosaicRects } from '../../model/layout';
import { CANVAS_PRESETS, CUSTOM_PRESET_ID, validateCanvasSize } from '../../model/presets';
import type { Background, ImageLayer, LayoutMode, ProjectDoc } from '../../model/types';
import { assetsRepo, StorageError } from '../../storage/db';
import { toMeta, useEditor } from '../../state/editorStore';
import { thumbUrl } from '../../state/imageCache';
import { toast } from '../../state/toast';
import { useLive } from './useLive';

export type PanelId = 'images' | 'layout' | 'background' | 'edit' | 'arrange' | 'size';

function mapLayer(doc: ProjectDoc, id: string, fn: (l: ImageLayer) => ImageLayer): ProjectDoc {
  return { ...doc, imageLayers: doc.imageLayers.map((l) => (l.id === id ? fn(l) : l)) };
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-center text-[13px] text-muted">{children}</p>;
}

// ---------------- 画像追加 ----------------
export function ImagesPanel() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const addFiles = useEditor((s) => s.addFiles);
  const addLayerFromAsset = useEditor((s) => s.addLayerFromAsset);
  const removeAsset = useEditor((s) => s.removeAsset);
  const picker = useRef<FilePickerHandle>(null);
  const ids = doc.assetIds.filter((id) => assets[id]);
  return (
    <div>
      <Button variant="primary" className="w-full" onClick={() => picker.current?.open()}>
        <ImagePlus size={20} /> 写真を追加
      </Button>
      {ids.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-[12px] text-muted">タップで同じ画像をもう1枚配置・×で画像を削除</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {ids.map((id) => (
              <div key={id} className="relative h-16 w-16 shrink-0">
                <button
                  className="h-16 w-16 overflow-hidden rounded-lg bg-surface-3 active:opacity-70"
                  onClick={() => addLayerFromAsset(id)}
                  aria-label={`${assets[id].name}を配置`}
                >
                  <img src={thumbUrl(assets[id])} alt="" className="h-full w-full object-cover" />
                </button>
                <button
                  aria-label={`${assets[id].name}を削除`}
                  className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/80 text-[12px]"
                  onClick={() => removeAsset(id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <FilePicker ref={picker} onFiles={addFiles} />
    </div>
  );
}

// ---------------- レイアウト ----------------
function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[13px] text-muted">{label}</span>
      <div className="flex items-center gap-1">
        <button aria-label={`${label}を減らす`} className="h-11 w-11 rounded-full bg-surface-3 text-[20px] disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="w-8 text-center tabular-nums">{value}</span>
        <button aria-label={`${label}を増やす`} className="h-11 w-11 rounded-full bg-surface-3 text-[20px] disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)}>
          ＋
        </button>
      </div>
    </div>
  );
}

function MosaicThumb({ seed, active, doc, onClick }: { seed: number; active: boolean; doc: ProjectDoc; onClick: () => void }) {
  const W = doc.canvasWidth;
  const H = doc.canvasHeight;
  const rects = mosaicRects(Math.max(1, doc.imageLayers.length), { seed, gap: W * 0.02, padding: W * 0.03 }, { width: W, height: H });
  return (
    <button
      onClick={onClick}
      aria-label={`レイアウト候補 ${seed}`}
      aria-pressed={active}
      className={cx('shrink-0 rounded-lg p-1', active ? 'bg-accent' : 'bg-surface-3')}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-20 w-auto" style={{ aspectRatio: `${W}/${H}` }}>
        <rect width={W} height={H} fill="#1c1c1e" />
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill="#8e8e93" rx={W * 0.01} />
        ))}
      </svg>
    </button>
  );
}

export function LayoutPanel() {
  const doc = useEditor((s) => s.doc)!;
  const commit = useEditor((s) => s.commit);
  const live = useLive();
  const [base, setBase] = useState(() => Math.floor(doc.mosaic.seed / 4) * 4);
  const maxGap = Math.round(doc.canvasWidth * 0.08);
  const maxPad = Math.round(doc.canvasWidth * 0.15);

  const setMode = (m: LayoutMode) =>
    commit((d) => ({
      ...d,
      layoutMode: m,
      // フリーモードに戻すときは全画像を表示状態に戻す
      imageLayers: m === 'free' ? d.imageLayers.map((l) => (l.visible ? l : { ...l, visible: true })) : d.imageLayers,
    }));

  const n = doc.imageLayers.length;
  const cells = doc.grid.rows * doc.grid.cols;
  return (
    <div className="space-y-2">
      <Segmented<LayoutMode>
        value={doc.layoutMode}
        onChange={setMode}
        options={[
          { value: 'free', label: 'フリー' },
          { value: 'grid', label: 'グリッド' },
          { value: 'mosaic', label: 'モザイク' },
        ]}
      />
      {doc.layoutMode === 'free' && <Hint>画像を自由に移動・拡大・回転できます。2本指でピンチ・回転。</Hint>}
      {doc.layoutMode === 'grid' && (
        <div>
          <label className="flex min-h-11 items-center justify-between">
            <span className="text-[13px] text-muted">枚数に合わせて自動</span>
            <input
              type="checkbox"
              className="h-6 w-6 accent-[#0a84ff]"
              checked={doc.grid.auto}
              onChange={(e) =>
                commit((d) => {
                  const dims = autoGridDims(d.imageLayers.length, { width: d.canvasWidth, height: d.canvasHeight });
                  return { ...d, grid: { ...d.grid, auto: e.target.checked, ...(e.target.checked ? dims : {}) } };
                })
              }
            />
          </label>
          <Stepper label="行" value={doc.grid.rows} min={1} max={12} onChange={(rows) => commit((d) => ({ ...d, grid: { ...d.grid, auto: false, rows } }))} />
          <Stepper label="列" value={doc.grid.cols} min={1} max={8} onChange={(cols) => commit((d) => ({ ...d, grid: { ...d.grid, auto: false, cols } }))} />
          <SliderRow label="画像間余白" value={doc.grid.gap} min={0} max={maxGap} onStart={live.start} onEnd={live.end} onChange={(gap) => live.change((d) => ({ ...d, grid: { ...d.grid, gap } }))} />
          <SliderRow label="外周余白" value={doc.grid.padding} min={0} max={maxPad} onStart={live.start} onEnd={live.end} onChange={(padding) => live.change((d) => ({ ...d, grid: { ...d.grid, padding } }))} />
          {cells < n && <p className="text-[12px] text-[#ffd60a]">セル数（{cells}）より画像が多いため、{n - cells}枚が表示されていません。</p>}
          <Hint>画像をドラッグで表示範囲を調整、ピンチで拡大。並び順は「重なり」で変更。</Hint>
        </div>
      )}
      {doc.layoutMode === 'mosaic' && (
        <div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
            {[0, 1, 2, 3].map((i) => (
              <MosaicThumb key={base + i} seed={base + i + 1} active={doc.mosaic.seed === base + i + 1} doc={doc} onClick={() => commit((d) => ({ ...d, mosaic: { ...d.mosaic, seed: base + i + 1 } }))} />
            ))}
          </div>
          <Button
            className="mt-1 w-full"
            onClick={() => {
              const nb = base + 4;
              setBase(nb);
              commit((d) => ({ ...d, mosaic: { ...d.mosaic, seed: nb + 1 } }));
            }}
          >
            <RefreshCw size={18} /> レイアウトを再生成
          </Button>
          <SliderRow label="画像間余白" value={doc.mosaic.gap} min={0} max={maxGap} onStart={live.start} onEnd={live.end} onChange={(gap) => live.change((d) => ({ ...d, mosaic: { ...d.mosaic, gap } }))} />
          <SliderRow label="外周余白" value={doc.mosaic.padding} min={0} max={maxPad} onStart={live.start} onEnd={live.end} onChange={(padding) => live.change((d) => ({ ...d, mosaic: { ...d.mosaic, padding } }))} />
          <Hint>画像をドラッグで表示範囲を調整、ピンチで拡大。</Hint>
        </div>
      )}
    </div>
  );
}

// ---------------- 背景 ----------------
const SWATCHES = ['#000000', '#1c1c1e', '#ffffff', '#f2e8dc', '#ffd1dc', '#c7e9ff', '#d4f5d0', '#2b2d42', '#5e548e', '#ff6b6b', '#ffb703', '#118ab2'];
const GRADIENTS: [string, string][] = [
  ['#232526', '#414345'],
  ['#ff9a9e', '#fad0c4'],
  ['#a18cd1', '#fbc2eb'],
  ['#84fab0', '#8fd3f4'],
  ['#0f2027', '#2c5364'],
  ['#f6d365', '#fda085'],
];

export function BackgroundPanel() {
  const doc = useEditor((s) => s.doc)!;
  const project = useEditor((s) => s.project)!;
  const commit = useEditor((s) => s.commit);
  const assets = useEditor((s) => s.assets);
  const live = useLive();
  const picker = useRef<FilePickerHandle>(null);
  const [busy, setBusy] = useState(false);
  const bg = doc.background;
  const setBg = (b: Background) => commit((d) => ({ ...d, background: b }));

  const pickImage = async (files: File[]) => {
    setBusy(true);
    try {
      const asset = await importImageFile(files[0], project.id);
      await assetsRepo.put(asset);
      useEditor.setState({ assets: { ...useEditor.getState().assets, [asset.id]: toMeta(asset) } });
      setBg({ type: 'image', assetId: asset.id, fit: { ...DEFAULT_FIT }, color: '#000000' });
    } catch (e) {
      toast.error(e instanceof ImageImportError || e instanceof StorageError ? e.message : '背景画像を読み込めませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const type = bg.type;
  return (
    <div className="space-y-2">
      <Segmented<Background['type']>
        value={type}
        onChange={(t) => {
          if (t === type) return;
          if (t === 'color') setBg({ type: 'color', color: '#1c1c1e' });
          if (t === 'gradient') setBg({ type: 'gradient', from: GRADIENTS[1][0], to: GRADIENTS[1][1], angle: 180 });
          if (t === 'transparent') setBg({ type: 'transparent' });
          if (t === 'image') picker.current?.open();
        }}
        options={[
          { value: 'color', label: '単色' },
          { value: 'gradient', label: 'グラデ' },
          { value: 'image', label: '画像' },
          { value: 'transparent', label: '透明' },
        ]}
      />
      {bg.type === 'color' && (
        <div className="flex flex-wrap items-center gap-2 py-1">
          {SWATCHES.map((c) => (
            <button
              key={c}
              aria-label={`背景色 ${c}`}
              onClick={() => setBg({ type: 'color', color: c })}
              className={cx('h-10 w-10 rounded-full border', bg.color.toLowerCase() === c ? 'border-accent ring-2 ring-accent' : 'border-white/20')}
              style={{ background: c }}
            />
          ))}
          <label className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/20" style={{ background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }} aria-label="任意の色">
            <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={bg.color} onChange={(e) => live.change((d) => ({ ...d, background: { type: 'color', color: e.target.value } }))} />
          </label>
        </div>
      )}
      {bg.type === 'gradient' && (
        <div>
          <div className="flex flex-wrap gap-2 py-1">
            {GRADIENTS.map(([f, t]) => (
              <button key={f + t} aria-label="グラデーション" onClick={() => setBg({ ...bg, from: f, to: t })} className="h-10 w-10 rounded-full border border-white/20" style={{ background: `linear-gradient(180deg, ${f}, ${t})` }} />
            ))}
          </div>
          <div className="flex items-center gap-3 py-1 text-[13px] text-muted">
            <label className="flex items-center gap-2">
              開始 <input type="color" value={bg.from} onChange={(e) => live.change((d) => ({ ...d, background: { ...bg, from: e.target.value } }))} className="h-9 w-12" />
            </label>
            <label className="flex items-center gap-2">
              終了 <input type="color" value={bg.to} onChange={(e) => live.change((d) => ({ ...d, background: { ...bg, to: e.target.value } }))} className="h-9 w-12" />
            </label>
          </div>
          <SliderRow label="角度" value={bg.angle} min={0} max={360} format={(v) => `${v}°`} onStart={live.start} onEnd={live.end} onChange={(angle) => live.change((d) => ({ ...d, background: { ...bg, angle } }))} />
        </div>
      )}
      {bg.type === 'image' && (
        <div>
          <div className="flex items-center gap-3">
            {assets[bg.assetId] && <img src={thumbUrl(assets[bg.assetId])} alt="" className="h-12 w-12 rounded-lg object-cover" />}
            <Button className="flex-1" disabled={busy} onClick={() => picker.current?.open()}>
              <ImagePlus size={18} /> 背景画像を変更
            </Button>
          </div>
          <SliderRow label="拡大" value={bg.fit.zoom} min={1} max={4} step={0.01} format={(v) => `${v.toFixed(1)}×`} onStart={live.start} onEnd={live.end} onChange={(zoom) => live.change((d) => ({ ...d, background: { ...bg, fit: { ...bg.fit, zoom } } }))} />
          <SliderRow label="横位置" value={bg.fit.focusX} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onStart={live.start} onEnd={live.end} onChange={(focusX) => live.change((d) => ({ ...d, background: { ...bg, fit: { ...bg.fit, focusX } } }))} />
          <SliderRow label="縦位置" value={bg.fit.focusY} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onStart={live.start} onEnd={live.end} onChange={(focusY) => live.change((d) => ({ ...d, background: { ...bg, fit: { ...bg.fit, focusY } } }))} />
        </div>
      )}
      {bg.type === 'transparent' && <Hint>透明背景はPNG形式で書き出したときに有効です（JPEGでは黒になります）。</Hint>}
      {busy && <Hint>背景画像を読み込み中…</Hint>}
      <FilePicker ref={picker} multiple={false} onFiles={pickImage} />
    </div>
  );
}

// ---------------- 画像編集 ----------------
const RATIOS: { label: string; value: number | 'original' }[] = [
  { label: '元の比率', value: 'original' },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '3:4', value: 3 / 4 },
  { label: '2:3', value: 2 / 3 },
  { label: '9:16', value: 9 / 16 },
  { label: '16:9', value: 16 / 9 },
];

export function EditPanel() {
  const doc = useEditor((s) => s.doc)!;
  const selectedId = useEditor((s) => s.selectedId);
  const assets = useEditor((s) => s.assets);
  const cropMode = useEditor((s) => s.cropMode);
  const setCropMode = useEditor((s) => s.setCropMode);
  const commit = useEditor((s) => s.commit);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const deleteLayer = useEditor((s) => s.deleteLayer);
  const live = useLive();
  const layer = doc.imageLayers.find((l) => l.id === selectedId);
  if (!layer) return <Hint>編集する画像をタップして選択してください</Hint>;
  const asset = assets[layer.assetId];
  const free = doc.layoutMode === 'free';
  const set = (patch: Partial<ImageLayer>) => commit((d) => mapLayer(d, layer.id, (l) => ({ ...l, ...patch })));
  const liveSet = (patch: Partial<ImageLayer>) => live.change((d) => mapLayer(d, layer.id, (l) => ({ ...l, ...patch })));

  const applyRatio = (r: number | 'original') => {
    if (!asset) return;
    const ratio = r === 'original' ? asset.originalWidth / asset.originalHeight : r;
    commit((d) =>
      mapLayer(d, layer.id, (l) => {
        const area = l.width * l.height;
        const width = Math.sqrt(area * ratio);
        const height = Math.sqrt(area / ratio);
        const fit = r === 'original' ? { ...DEFAULT_FIT } : l.fit;
        return recomputeCrop({ ...l, width, height, fit }, { width: asset.originalWidth, height: asset.originalHeight });
      }),
    );
    if (r !== 'original') setCropMode(true);
  };

  const smallBtn = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-surface-3 text-[11px] active:opacity-70 disabled:opacity-30';
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button className={smallBtn} onClick={() => set({ flipX: !layer.flipX })}>
          <FlipHorizontal2 size={20} /> 左右反転
        </button>
        <button className={smallBtn} onClick={() => set({ flipY: !layer.flipY })}>
          <FlipVertical2 size={20} /> 上下反転
        </button>
        {free && (
          <button className={cx(smallBtn, cropMode && 'bg-[#ffd60a] text-black')} onClick={() => setCropMode(!cropMode)} aria-pressed={cropMode}>
            <Crop size={20} /> {cropMode ? '完了' : 'トリミング'}
          </button>
        )}
        <button className={smallBtn} onClick={() => duplicateLayer(layer.id)}>
          <Copy size={20} /> 複製
        </button>
        <button className={cx(smallBtn, 'text-danger')} onClick={() => deleteLayer(layer.id)}>
          <Trash2 size={20} /> 削除
        </button>
      </div>
      {free && cropMode && (
        <div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">
            {RATIOS.map((r) => (
              <button key={r.label} className="min-h-10 shrink-0 rounded-full bg-surface-3 px-3 text-[13px] active:opacity-70" onClick={() => applyRatio(r.value)}>
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-center text-[12px] text-[#ffd60a]">画像をドラッグで表示範囲を移動、ピンチで拡大</p>
        </div>
      )}
      {!free && (
        <SliderRow
          label="拡大"
          value={layer.fit.zoom}
          min={1}
          max={8}
          step={0.01}
          format={(v) => `${v.toFixed(1)}×`}
          onStart={live.start}
          onEnd={live.end}
          onChange={(zoom) => live.change((d) => mapLayer(d, layer.id, (l) => (asset ? recomputeCrop({ ...l, fit: { ...l.fit, zoom } }, { width: asset.originalWidth, height: asset.originalHeight }) : l)))}
        />
      )}
      {free && (
        <SliderRow label="回転" value={Math.round(layer.rotation)} min={-180} max={180} format={(v) => `${v}°`} onStart={live.start} onEnd={live.end} onChange={(rotation) => liveSet({ rotation })} />
      )}
      <SliderRow
        label="角丸"
        value={layer.borderRadius}
        min={0}
        max={Math.round(Math.min(layer.width, layer.height) / 2)}
        onStart={live.start}
        onEnd={live.end}
        onChange={(borderRadius) => liveSet({ borderRadius })}
      />
      <SliderRow label="不透明度" value={Math.round(layer.opacity * 100)} min={5} max={100} format={(v) => `${v}%`} onStart={live.start} onEnd={live.end} onChange={(v) => liveSet({ opacity: v / 100 })} />
      {free && (
        <button className="flex min-h-11 items-center gap-2 text-[14px] text-white/80" onClick={() => set({ locked: !layer.locked })}>
          {layer.locked ? <Lock size={18} /> : <Unlock size={18} />}
          {layer.locked ? 'ロック中（タップで解除）' : '位置をロック'}
        </button>
      )}
    </div>
  );
}

// ---------------- 重なり順 ----------------
export function ArrangePanel() {
  const doc = useEditor((s) => s.doc)!;
  const selectedId = useEditor((s) => s.selectedId);
  const reorder = useEditor((s) => s.reorder);
  const layer = doc.imageLayers.find((l) => l.id === selectedId);
  if (!layer) return <Hint>並べ替える画像をタップして選択してください</Hint>;
  const free = doc.layoutMode === 'free';
  const last = doc.imageLayers.length - 1;
  const btn = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-surface-3 text-[11px] active:opacity-70 disabled:opacity-30';
  return (
    <div>
      <div className="flex gap-2">
        <button className={btn} disabled={layer.zIndex >= last} onClick={() => reorder(layer.id, 'front')}>
          <ArrowUpToLine size={20} /> {free ? '最前面' : '最後へ'}
        </button>
        <button className={btn} disabled={layer.zIndex >= last} onClick={() => reorder(layer.id, 'forward')}>
          <ChevronUp size={20} /> {free ? '前面へ' : '後ろへ'}
        </button>
        <button className={btn} disabled={layer.zIndex <= 0} onClick={() => reorder(layer.id, 'backward')}>
          <ChevronDown size={20} /> {free ? '背面へ' : '前へ'}
        </button>
        <button className={btn} disabled={layer.zIndex <= 0} onClick={() => reorder(layer.id, 'back')}>
          <ArrowDownToLine size={20} /> {free ? '最背面' : '最初へ'}
        </button>
      </div>
      <Hint>
        {free ? `重なり：下から${layer.zIndex + 1}番目 / ${last + 1}枚` : `並び順：${layer.zIndex + 1}番目 / ${last + 1}枚`}
      </Hint>
    </div>
  );
}

// ---------------- 壁紙サイズ ----------------
function resizeDoc(d: ProjectDoc, presetId: string, width: number, height: number): ProjectDoc {
  const sx = width / d.canvasWidth;
  const sy = height / d.canvasHeight;
  const s = Math.min(sx, sy);
  return {
    ...d,
    presetId,
    canvasWidth: width,
    canvasHeight: height,
    grid: { ...d.grid, gap: Math.round(d.grid.gap * s), padding: Math.round(d.grid.padding * s) },
    mosaic: { ...d.mosaic, gap: Math.round(d.mosaic.gap * s), padding: Math.round(d.mosaic.padding * s) },
    imageLayers: d.imageLayers.map((l) => ({
      ...l,
      x: l.x * sx,
      y: l.y * sy,
      width: l.width * s,
      height: l.height * s,
      borderRadius: l.borderRadius * s,
    })),
  };
}

export function SizePanel() {
  const doc = useEditor((s) => s.doc)!;
  const commit = useEditor((s) => s.commit);
  const [w, setW] = useState(String(doc.canvasWidth));
  const [h, setH] = useState(String(doc.canvasHeight));
  const [err, setErr] = useState<string | null>(null);
  const applyCustom = () => {
    const width = Math.round(Number(w));
    const height = Math.round(Number(h));
    const e = validateCanvasSize(width, height);
    setErr(e);
    if (!e) commit((d) => resizeDoc(d, CUSTOM_PRESET_ID, width, height));
  };
  return (
    <div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {CANVAS_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setW(String(p.width));
              setH(String(p.height));
              setErr(null);
              commit((d) => resizeDoc(d, p.id, p.width, p.height));
            }}
            aria-pressed={doc.presetId === p.id}
            className={cx('min-h-14 shrink-0 rounded-xl px-3 text-left', doc.presetId === p.id ? 'bg-accent' : 'bg-surface-3')}
          >
            <span className="block text-[13px] font-semibold">{p.label}</span>
            <span className="block text-[11px] text-white/70 tabular-nums">{p.note}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-muted">任意</span>
        <input inputMode="numeric" aria-label="幅" value={w} onChange={(e) => setW(e.target.value)} className="h-11 w-20 rounded-lg bg-surface-3 px-2 text-center tabular-nums" />
        <span className="text-muted">×</span>
        <input inputMode="numeric" aria-label="高さ" value={h} onChange={(e) => setH(e.target.value)} className="h-11 w-20 rounded-lg bg-surface-3 px-2 text-center tabular-nums" />
        <Button onClick={applyCustom} className="flex-1">
          適用
        </Button>
      </div>
      {err && <p className="mt-1 text-[12px] text-danger">{err}</p>}
    </div>
  );
}
