import { useEffect, useRef } from 'react';
import type { ProjectDoc } from '../../model/types';
import { useEditor } from '../../state/editorStore';

/**
 * スライダーなど連続的な操作用。
 * 操作中はライブ更新し、操作が終わったら 1 回分の履歴として確定する。
 */
export function useLive() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        useEditor.getState().endGesture();
      }
    },
    [],
  );
  const end = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    useEditor.getState().endGesture();
  };
  return {
    start: () => useEditor.getState().beginGesture(),
    change: (fn: (doc: ProjectDoc) => ProjectDoc) => {
      const s = useEditor.getState();
      s.beginGesture();
      s.updateLive(fn);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(end, 700);
    },
    end,
  };
}
