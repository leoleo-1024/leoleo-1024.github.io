import { ChevronLeft, Flashlight, Camera } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Header, IconButton, Segmented, cx } from '../components/ui';
import { navigate } from '../lib/router';
import { renderProject } from '../render/renderProject';
import { useEditor } from '../state/editorStore';
import { getPreviewById } from '../state/imageCache';

type Mode = 'lock' | 'home' | 'plain';

/** 画面に表示するプレビュー用のレンダリング（縮小画像を使用、書き出しと同じ描画エンジン） */
function PreviewCanvas({ width, height }: { width: number; height: number }) {
  const doc = useEditor((s) => s.doc)!;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const off = document.createElement('canvas');
    renderProject(
      off,
      doc,
      async (id) => {
        const p = await getPreviewById(id);
        return p ? { source: { image: p.img, width: p.width, height: p.height } } : null;
      },
      { scale: (width * dpr) / doc.canvasWidth },
    )
      .then(() => {
        if (cancelled) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
        off.width = 0;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, width]);
  return <canvas ref={ref} style={{ width, height }} className="block" data-testid="preview-canvas" />;
}

function useFitSize(aspect: number) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => {
      const availW = el.clientWidth - 32;
      const availH = el.clientHeight - 24;
      let w = availW;
      let h = w / aspect;
      if (h > availH) {
        h = availH;
        w = h * aspect;
      }
      setSize({ width: Math.max(0, Math.floor(w)), height: Math.max(0, Math.floor(h)) });
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [aspect]);
  return { box, size };
}

function LockOverlay({ h, guides }: { h: number; guides: boolean }) {
  const now = new Date();
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const date = `${now.getMonth() + 1}月${now.getDate()}日 ${days[now.getDay()]}曜日`;
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const u = h / 100; // 高さの 1%
  return (
    <div className="pointer-events-none absolute inset-0 text-white" style={{ textShadow: '0 1px 6px rgba(0,0,0,.35)' }}>
      <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: 1.3 * u, width: '32%', height: 4.2 * u }} />
      <div className="absolute inset-x-0 text-center font-semibold" style={{ top: 7.2 * u, fontSize: 2.1 * u }}>
        {date}
      </div>
      <div className="absolute inset-x-0 text-center font-bold tracking-tight" style={{ top: 8.6 * u, fontSize: 11.5 * u, lineHeight: 1 }}>
        {time}
      </div>
      <div className="absolute flex justify-center gap-[3%]" style={{ top: 21.5 * u, left: '9%', right: '9%', height: 7 * u }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 rounded-full bg-white/25 backdrop-blur" />
        ))}
      </div>
      <div className="absolute flex items-center justify-center rounded-full bg-black/35" style={{ bottom: 5 * u, left: '11%', width: 5.6 * u, height: 5.6 * u }}>
        <Flashlight size={2.4 * u} />
      </div>
      <div className="absolute flex items-center justify-center rounded-full bg-black/35" style={{ bottom: 5 * u, right: '11%', width: 5.6 * u, height: 5.6 * u }}>
        <Camera size={2.4 * u} />
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-white" style={{ bottom: 1 * u, width: '36%', height: 0.6 * u }} />
      {guides && (
        <>
          <div className="absolute inset-x-[6%] rounded-lg border-2 border-dashed border-[#ffd60a]" style={{ top: 6.5 * u, height: 14 * u }}>
            <span className="absolute top-0.5 right-0.5 rounded bg-[#ffd60a] px-1 text-[10px] text-black" style={{ textShadow: 'none' }}>
              時計の領域（目安）
            </span>
          </div>
          <div className="absolute inset-x-[6%] rounded-lg border-2 border-dashed border-[#64d2ff]" style={{ top: 21 * u, height: 8 * u }}>
            <span className="absolute -bottom-5 right-0 rounded bg-[#64d2ff] px-1 text-[10px] text-black" style={{ textShadow: 'none' }}>
              ウィジェット（目安）
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function HomeOverlay({ w, h, guides }: { w: number; h: number; guides: boolean }) {
  const u = h / 100;
  const icon = w * 0.15;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: 1.3 * u, width: '32%', height: 4.2 * u }} />
      <div className="absolute grid grid-cols-4 justify-items-center" style={{ top: 8 * u, left: '6%', right: '6%', rowGap: 3.2 * u }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="rounded-[22%] bg-white/30 backdrop-blur" style={{ width: icon, height: icon }} />
            <div className="rounded bg-white/40" style={{ width: icon * 0.7, height: Math.max(3, u * 0.6) }} />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-[3%] flex items-center justify-around rounded-[28px] bg-white/20 backdrop-blur" style={{ bottom: 2.4 * u, height: 10 * u }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-[22%] bg-white/40" style={{ width: icon, height: icon }} />
        ))}
      </div>
      {guides && (
        <div className="absolute inset-x-[3%] rounded-[28px] border-2 border-dashed border-[#64d2ff]" style={{ bottom: 2.4 * u, height: 10 * u }}>
          <span className="absolute -top-5 left-0 rounded bg-[#64d2ff] px-1 text-[10px] text-black">Dock（目安）</span>
        </div>
      )}
    </div>
  );
}

export function PreviewScreen({ projectId }: { projectId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const [mode, setMode] = useState<Mode>('lock');
  const [guides, setGuides] = useState(true);
  const { box, size } = useFitSize(doc.canvasWidth / doc.canvasHeight);
  return (
    <div className="flex h-full flex-col">
      <Header
        left={
          <IconButton label="編集に戻る" onClick={() => navigate({ name: 'editor', projectId })}>
            <ChevronLeft size={26} />
          </IconButton>
        }
        title="プレビュー"
        right={
          <button className="min-h-11 px-3 text-[15px] font-semibold text-accent" onClick={() => navigate({ name: 'export', projectId })}>
            書き出し
          </button>
        }
      />
      <div className="px-4 pb-2">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'lock', label: 'ロック画面' },
            { value: 'home', label: 'ホーム画面' },
            { value: 'plain', label: '画像のみ' },
          ]}
        />
      </div>
      <div ref={box} className="flex min-h-0 flex-1 items-center justify-center">
        {size.width > 0 && (
          <div
            className={cx('relative overflow-hidden bg-black shadow-2xl', mode !== 'plain' && 'ring-4 ring-[#2c2c2e]')}
            style={{ width: size.width, height: size.height, borderRadius: mode === 'plain' ? 4 : size.width * 0.13 }}
          >
            <PreviewCanvas width={size.width} height={size.height} />
            {mode === 'lock' && <LockOverlay h={size.height} guides={guides} />}
            {mode === 'home' && <HomeOverlay w={size.width} h={size.height} guides={guides} />}
          </div>
        )}
      </div>
      <div className="pb-safe px-4 pt-2">
        {mode !== 'plain' && (
          <label className="flex min-h-11 items-center justify-between">
            <span className="text-[14px]">ガイドを表示</span>
            <input type="checkbox" className="h-6 w-6 accent-[#0a84ff]" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
          </label>
        )}
        <p className="pb-3 text-[11px] leading-relaxed text-muted">
          時計・ウィジェット・アイコンは参考表示で、書き出す画像には含まれません。iOSの壁紙設定時に拡大や位置調整（視差効果など）で見え方が変わることがあります。
        </p>
      </div>
    </div>
  );
}
