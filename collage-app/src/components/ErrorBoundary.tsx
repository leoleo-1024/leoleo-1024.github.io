import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** 描画中の予期しないエラーで画面が真っ白にならないようにする */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-[18px] font-semibold">エラーが発生しました</h1>
        <p className="text-[14px] text-white/70">
          画面の表示中に問題が発生しました。編集内容は自動保存されています。再読み込みして続きから再開してください。
        </p>
        <p className="max-w-full truncate text-[11px] text-muted">{this.state.error.message}</p>
        <button
          className="min-h-11 rounded-xl bg-accent px-5 font-semibold"
          onClick={() => {
            location.hash = '#/';
            location.reload();
          }}
        >
          再読み込み
        </button>
      </div>
    );
  }
}
