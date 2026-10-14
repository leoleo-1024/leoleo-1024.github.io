import { useEditor } from './state/editorStore';

/**
 * E2E テスト専用：ブラウザのコンソール／Playwright から編集状態を参照できるようにする。
 * VITE_E2E=1 でビルドしたときだけ読み込まれる（本番ビルドには含まれない）。外部への送信は行わない。
 */
export function installTestHooks() {
  (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;
}
