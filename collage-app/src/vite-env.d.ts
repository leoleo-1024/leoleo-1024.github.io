/// <reference types="vite/client" />
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** E2E テスト用ビルドのときだけ '1'（playwright.config.ts で指定） */
  readonly VITE_E2E?: string;
}
