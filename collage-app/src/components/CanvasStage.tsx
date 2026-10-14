import Konva from 'konva';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Image as KImage, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import {
  applyPinch,
  clamp,
  coverCrop,
  layerCorners,
  MIN_LAYER_SIZE,
  panFit,
  pointInLayer,
  snapToCenter,
  zoomFit,
  type PinchStart,
} from '../model/geometry';
import { gradientPoints } from '../render/renderProject';
import type { Background, ImageLayer, ProjectDoc } from '../model/types';
import { useEditor } from '../state/editorStore';
import { usePreview } from './usePreview';

/** 画面上の余白（px）。選択ハンドルがはみ出しても操作できるようにする */
const MARGIN = 20;
const SNAP_PX = 10;
const TAP_SLOP = 6;

export interface StageHandle {
  /** テスト・検証用：現在の表示を出力サイズでラスタライズする */
  toDataURL: () => string;
}

export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

function computeViewport(w: number, h: number, cw: number, ch: number): Viewport {
  const scale = Math.max(0.01, Math.min((w - MARGIN * 2) / cw, (h - MARGIN * 2) / ch));
  return { scale, ox: (w - cw * scale) / 2, oy: (h - ch * scale) / 2, width: w, height: h };
}

const LayerNode = memo(function LayerNode({
  layer,
  registerRef,
}: {
  layer: ImageLayer;
  registerRef: (id: string, node: Konva.Group | null) => void;
}) {
  const preview = usePreview(layer.assetId);
  const { width: w, height: h, crop } = layer;
  return (
    <Group
      ref={(n) => registerRef(layer.id, n)}
      id={layer.id}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
    >
      {preview ? (
        <KImage
          image={preview.img}
          x={layer.flipX ? w / 2 : -w / 2}
          y={layer.flipY ? h / 2 : -h / 2}
          scaleX={layer.flipX ? -1 : 1}
          scaleY={layer.flipY ? -1 : 1}
          width={w}
          height={h}
          crop={{
            x: crop.x * preview.width,
            y: crop.y * preview.height,
            width: crop.width * preview.width,
            height: crop.height * preview.height,
          }}
          cornerRadius={Math.min(layer.borderRadius, w / 2, h / 2)}
        />
      ) : (
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#3a3a3c" cornerRadius={Math.min(layer.borderRadius, w / 2, h / 2)} />
      )}
    </Group>
  );
});

function BackgroundNode({ bg, width, height }: { bg: Background; width: number; height: number }) {
  const preview = usePreview(bg.type === 'image' ? bg.assetId : undefined);
  if (bg.type === 'color') return <Rect width={width} height={height} fill={bg.color} />;
  if (bg.type === 'gradient') {
    const p = gradientPoints(width, height, bg.angle);
    return (
      <Rect
        width={width}
        height={height}
        fillLinearGradientStartPoint={{ x: p.x0, y: p.y0 }}
        fillLinearGradientEndPoint={{ x: p.x1, y: p.y1 }}
        fillLinearGradientColorStops={[0, bg.from, 1, bg.to]}
      />
    );
  }
  if (bg.type === 'image') {
    const crop = preview ? coverCrop(preview, { width, height }, bg.fit).crop : null;
    return (
      <>
        <Rect width={width} height={height} fill={bg.color} />
        {preview && crop && (
          <KImage
            image={preview.img}
            width={width}
            height={height}
            crop={{
              x: crop.x * preview.width,
              y: crop.y * preview.height,
              width: crop.width * preview.width,
              height: crop.height * preview.height,
            }}
          />
        )}
      </>
    );
  }
  return null;
}

type DragState =
  | { kind: 'none' }
  | {
      kind: 'drag';
      layerId: string;
      mode: 'move' | 'pan';
      base: ImageLayer;
      startClientX: number;
      startClientY: number;
      active: boolean;
    }
  | { kind: 'pinch'; layerId: string; mode: 'move' | 'pan'; base: ImageLayer; start: PinchStart };

function pinchOf(a: { x: number; y: number }, b: { x: number; y: number }): PinchStart {
  return {
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function replaceLayer(doc: ProjectDoc, layer: ImageLayer): ProjectDoc {
  return { ...doc, imageLayers: doc.imageLayers.map((l) => (l.id === layer.id ? layer : l)) };
}

export function CanvasStage({ onReady }: { onReady?: (h: StageHandle) => void }) {
  const doc = useEditor((s) => s.doc)!;
  const selectedId = useEditor((s) => s.selectedId);
  const cropMode = useEditor((s) => s.cropMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const contentRef = useRef<Konva.Group>(null);
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState({ x: false, y: false });

  const vp = computeViewport(size.width, size.height, doc.canvasWidth, doc.canvasHeight);
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const registerRef = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const selected = doc.imageLayers.find((l) => l.id === selectedId) ?? null;
  const showTransformer = !!selected && doc.layoutMode === 'free' && !cropMode && !selected.locked && selected.visible;

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = showTransformer && selected ? nodeRefs.current.get(selected.id) : undefined;
    tr.nodes(node ? [node] : []);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  });

  useEffect(() => {
    onReady?.({
      toDataURL: () => {
        const stage = stageRef.current!;
        const v = vpRef.current;
        const ui = stage.getLayers()[1];
        ui.visible(false);
        const url = stage.toDataURL({
          x: v.ox,
          y: v.oy,
          width: doc.canvasWidth * v.scale,
          height: doc.canvasHeight * v.scale,
          pixelRatio: 1 / v.scale,
        });
        ui.visible(true);
        return url;
      },
    });
  });

  // ---- ジェスチャー処理（1 本指：移動 / 2 本指：拡大・回転） ----
  const pointers = useRef(new Map<number, { x: number; y: number; cx: number; cy: number }>());
  const drag = useRef<DragState>({ kind: 'none' });
  const tap = useRef<{ hitId: string | null; moved: boolean } | null>(null);

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = vpRef.current;
    return { x: (clientX - rect.left - v.ox) / v.scale, y: (clientY - rect.top - v.oy) / v.scale };
  }, []);

  const hitTest = useCallback((x: number, y: number): ImageLayer | null => {
    const d = useEditor.getState().doc;
    if (!d) return null;
    const layers = [...d.imageLayers].filter((l) => l.visible).sort((a, b) => b.zIndex - a.zIndex);
    return layers.find((l) => pointInLayer(l, x, y)) ?? null;
  }, []);

  const modeFor = useCallback((layer: ImageLayer): 'move' | 'pan' => {
    const s = useEditor.getState();
    if (s.doc?.layoutMode !== 'free') return 'pan';
    return s.cropMode && s.selectedId === layer.id ? 'pan' : 'move';
  }, []);

  const startDragFor = useCallback(
    (layer: ImageLayer, p: { x: number; y: number; cx: number; cy: number }, active: boolean) => {
      drag.current = {
        kind: 'drag',
        layerId: layer.id,
        mode: modeFor(layer),
        base: layer,
        startClientX: p.cx,
        startClientY: p.cy,
        active,
      };
    },
    [modeFor],
  );

  const startPinch = useCallback(() => {
    const s = useEditor.getState();
    const [a, b] = [...pointers.current.values()];
    const targetId = drag.current.kind !== 'none' ? drag.current.layerId : s.selectedId;
    const layer = s.doc?.imageLayers.find((l) => l.id === targetId);
    if (!layer || layer.locked) {
      drag.current = { kind: 'none' };
      return;
    }
    s.beginGesture();
    if (s.selectedId !== layer.id) s.select(layer.id);
    drag.current = { kind: 'pinch', layerId: layer.id, mode: modeFor(layer), base: layer, start: pinchOf(a, b) };
  }, [modeFor]);

  const assetSize = (layer: ImageLayer) => {
    const a = useEditor.getState().assets[layer.assetId];
    return a ? { width: a.originalWidth, height: a.originalHeight } : { width: layer.width, height: layer.height };
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isTransformerHit = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return false;
      stage.setPointersPositions(e);
      const pos = stage.getPointerPosition();
      if (!pos) return false;
      const shape = stage.getIntersection(pos);
      return !!shape && shape.getParent() instanceof Konva.Transformer;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isTransformerHit(e)) return; // ハンドル操作は Konva に任せる
      const c = toCanvas(e.clientX, e.clientY);
      const p = { ...c, cx: e.clientX, cy: e.clientY };
      pointers.current.set(e.pointerId, p);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const s = useEditor.getState();
      if (pointers.current.size === 1) {
        const hit = hitTest(c.x, c.y);
        tap.current = { hitId: hit?.id ?? null, moved: false };
        if (hit) {
          if (s.selectedId !== hit.id) s.select(hit.id);
          if (!hit.locked) {
            s.beginGesture();
            startDragFor(hit, p, false);
          }
        } else {
          drag.current = { kind: 'none' };
        }
      } else if (pointers.current.size === 2) {
        if (tap.current) tap.current.moved = true;
        startPinch();
      }
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const c = toCanvas(e.clientX, e.clientY);
      pointers.current.set(e.pointerId, { ...c, cx: e.clientX, cy: e.clientY });
      const s = useEditor.getState();
      const d = drag.current;
      const canvas = { width: s.doc!.canvasWidth, height: s.doc!.canvasHeight };

      if (d.kind === 'drag' && pointers.current.size === 1) {
        if (!d.active) {
          if (Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) < TAP_SLOP) return;
          d.active = true;
          if (tap.current) tap.current.moved = true;
        }
        // 画面上の移動量から算出する（操作中に表示領域が変わっても飛ばないように）
        const dx = (e.clientX - d.startClientX) / vpRef.current.scale;
        const dy = (e.clientY - d.startClientY) / vpRef.current.scale;
        if (d.mode === 'move') {
          const snapped = snapToCenter(d.base.x + dx, d.base.y + dy, canvas, SNAP_PX / vpRef.current.scale);
          setGuides((g) => (g.x === snapped.snapX && g.y === snapped.snapY ? g : { x: snapped.snapX, y: snapped.snapY }));
          s.updateLive((doc) => replaceLayer(doc, { ...d.base, x: snapped.x, y: snapped.y }));
        } else {
          s.updateLive((doc) => replaceLayer(doc, panFit(d.base, assetSize(d.base), dx, dy)));
        }
      } else if (d.kind === 'pinch' && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const now = pinchOf(a, b);
        if (d.mode === 'move') {
          s.updateLive((doc) => replaceLayer(doc, applyPinch(d.base, d.start, now, canvas)));
        } else {
          const ratio = now.distance / Math.max(d.start.distance, 1e-6);
          const zoomed = zoomFit(d.base, assetSize(d.base), clamp(d.base.fit.zoom * ratio, 1, 8));
          const panned = panFit(zoomed, assetSize(d.base), now.midX - d.start.midX, now.midY - d.start.midY);
          s.updateLive((doc) => replaceLayer(doc, panned));
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      const s = useEditor.getState();
      const remaining = [...pointers.current.values()];
      if (remaining.length === 1 && drag.current.kind === 'pinch') {
        // 2 本指 → 1 本指：残った指でそのまま移動を続ける
        const layer = s.doc?.imageLayers.find((l) => l.id === (drag.current as { layerId: string }).layerId);
        if (layer) startDragFor(layer, remaining[0], true);
        return;
      }
      if (remaining.length > 0) return;
      if (tap.current && !tap.current.moved && !tap.current.hitId) s.select(null);
      tap.current = null;
      drag.current = { kind: 'none' };
      setGuides({ x: false, y: false });
      s.endGesture();
    };

    // マウスホイール（PC）：拡大縮小、Shift + ホイールで回転
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      const s = useEditor.getState();
      const layer = s.doc?.imageLayers.find((l) => l.id === s.selectedId);
      if (!layer || layer.locked) return;
      e.preventDefault();
      s.beginGesture();
      const canvas = { width: s.doc!.canvasWidth, height: s.doc!.canvasHeight };
      let next: ImageLayer;
      if (modeFor(layer) === 'pan') {
        next = zoomFit(layer, assetSize(layer), layer.fit.zoom * Math.exp(-e.deltaY * 0.002));
      } else if (e.shiftKey) {
        next = { ...layer, rotation: layer.rotation + (e.deltaY > 0 ? 3 : -3) };
      } else {
        const sc = Math.exp(-e.deltaY * 0.002);
        const start = { midX: layer.x, midY: layer.y, distance: 1, angle: 0 };
        next = applyPinch(layer, start, { ...start, distance: sc }, canvas);
      }
      s.updateLive((doc) => replaceLayer(doc, next));
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => useEditor.getState().endGesture(), 350);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    // iOS Safari：キャンバス上のタッチでページがスクロール・拡大しないようにする
    const stopTouch = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchmove', stopTouch, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', stopTouch);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [toCanvas, hitTest, startDragFor, startPinch, modeFor]);

  // ---- Transformer（ハンドル）操作 ----
  const onTransformStart = () => useEditor.getState().beginGesture();
  const onTransformEnd = () => {
    const s = useEditor.getState();
    const node = trRef.current?.nodes()[0] as Konva.Group | undefined;
    const layer = s.doc?.imageLayers.find((l) => l.id === node?.id());
    if (!node || !layer) return s.endGesture();
    const sx = Math.abs(node.scaleX());
    const sy = Math.abs(node.scaleY());
    node.scaleX(1);
    node.scaleY(1);
    s.updateLayer(
      layer.id,
      {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: Math.max(MIN_LAYER_SIZE, layer.width * sx),
        height: Math.max(MIN_LAYER_SIZE, layer.height * sy),
      },
      true,
    );
    s.endGesture();
  };

  const sorted = [...doc.imageLayers].sort((a, b) => a.zIndex - b.zIndex);
  const { scale, ox, oy } = vp;
  const outline = selected && !showTransformer ? layerCorners(selected) : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden select-none"
      style={{ touchAction: 'none' }}
      data-testid="canvas-container"
    >
      {/* 透明背景のときの市松模様 */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: ox,
          top: oy,
          width: doc.canvasWidth * scale,
          height: doc.canvasHeight * scale,
          boxShadow: '0 4px 30px rgba(0,0,0,.5)',
          ...(doc.background.type === 'transparent'
            ? {
                backgroundColor: '#fff',
                backgroundImage:
                  'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
              }
            : {}),
        }}
      />
      {size.width > 0 && (
        <Stage ref={stageRef} width={size.width} height={size.height}>
          <Layer listening={false}>
            <Group
              ref={contentRef}
              x={ox}
              y={oy}
              scaleX={scale}
              scaleY={scale}
              clipX={0}
              clipY={0}
              clipWidth={doc.canvasWidth}
              clipHeight={doc.canvasHeight}
            >
              <BackgroundNode bg={doc.background} width={doc.canvasWidth} height={doc.canvasHeight} />
              {sorted.map((l) => (
                <LayerNode key={l.id} layer={l} registerRef={registerRef} />
              ))}
            </Group>
          </Layer>
          <Layer>
            <Group x={ox} y={oy} scaleX={scale} scaleY={scale} listening={false}>
              {guides.x && <Line points={[doc.canvasWidth / 2, 0, doc.canvasWidth / 2, doc.canvasHeight]} stroke="#ff375f" strokeWidth={1.5 / scale} dash={[8 / scale, 6 / scale]} />}
              {guides.y && <Line points={[0, doc.canvasHeight / 2, doc.canvasWidth, doc.canvasHeight / 2]} stroke="#ff375f" strokeWidth={1.5 / scale} dash={[8 / scale, 6 / scale]} />}
              {outline && (
                <Line
                  points={outline.flatMap((p) => [p.x, p.y])}
                  closed
                  stroke={cropMode ? '#ffd60a' : '#0a84ff'}
                  strokeWidth={2.5 / scale}
                  dash={cropMode ? [10 / scale, 6 / scale] : undefined}
                />
              )}
            </Group>
            <Transformer
              ref={trRef}
              keepRatio
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              rotateEnabled
              rotationSnaps={[0, 90, 180, 270]}
              rotationSnapTolerance={5}
              rotateAnchorOffset={34}
              anchorSize={16}
              anchorCornerRadius={8}
              anchorStroke="#0a84ff"
              anchorFill="#ffffff"
              anchorStrokeWidth={1.5}
              anchorStyleFunc={(anchor) => {
                // 見た目は小さく、タッチ判定は 44pt 相当に広げる
                anchor.hitStrokeWidth(28);
              }}
              borderStroke="#0a84ff"
              borderStrokeWidth={1.5}
              flipEnabled={false}
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) =>
                Math.abs(newBox.width) < MIN_LAYER_SIZE * scale || Math.abs(newBox.height) < MIN_LAYER_SIZE * scale ? oldBox : newBox
              }
              onTransformStart={onTransformStart}
              onTransformEnd={onTransformEnd}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}
