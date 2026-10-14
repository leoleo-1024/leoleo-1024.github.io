import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, ConfirmDialog, Header, IconButton } from '../components/ui';
import { navigate } from '../lib/router';
import { clearAllData, getStorageInfo, requestPersistence, type StorageInfo } from '../storage/db';
import { toast } from '../state/toast';

function mb(n?: number) {
  return n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsScreen() {
  const [info, setInfo] = useState<StorageInfo>({});
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void getStorageInfo().then(setInfo);
  useEffect(refresh, []);

  const persist = async () => {
    const ok = await requestPersistence();
    toast.info(ok ? 'データを保護するよう設定しました' : 'このブラウザでは設定できませんでした。ホーム画面に追加すると保護されやすくなります。');
    refresh();
  };

  const clear = async () => {
    setConfirm(false);
    try {
      await clearAllData();
      toast.info('すべてのデータを削除しました');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除できませんでした');
    }
  };

  const row = 'flex min-h-11 items-center justify-between text-[15px]';
  return (
    <div className="flex h-full flex-col">
      <Header
        left={
          <IconButton label="戻る" onClick={() => navigate({ name: 'home' })}>
            <ChevronLeft size={26} />
          </IconButton>
        }
        title="設定"
      />
      <main className="pb-safe flex-1 space-y-5 overflow-y-auto px-4 pt-3">
        <section>
          <h2 className="mb-1.5 px-1 text-[13px] text-muted">保存データ</h2>
          <div className="divide-y divide-white/10 rounded-2xl bg-surface px-4">
            <div className={row}>
              <span>使用中</span>
              <span className="text-muted tabular-nums">{mb(info.usage)}</span>
            </div>
            <div className={row}>
              <span>利用可能（目安）</span>
              <span className="text-muted tabular-nums">{mb(info.quota)}</span>
            </div>
            <div className={row}>
              <span>自動削除からの保護</span>
              {info.persisted ? <span className="text-muted">有効</span> : <Button variant="ghost" onClick={persist}>有効にする</Button>}
            </div>
          </div>
          <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-muted">
            プロジェクトと画像はこの端末のブラウザ内（IndexedDB）にのみ保存されます。Safariの「履歴とWebサイトデータを消去」を行うと削除されます。長期間使わない場合もブラウザにより削除されることがあるため、完成した壁紙は書き出して写真アプリに保存してください。
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 px-1 text-[13px] text-muted">ホーム画面に追加</h2>
          <p className="rounded-2xl bg-surface p-4 text-[13px] leading-relaxed text-white/80">
            Safariの共有ボタン →「ホーム画面に追加」で、アプリのように全画面で使えます。一度読み込めばオフラインでも編集できます。
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 px-1 text-[13px] text-muted">プライバシー</h2>
          <p className="rounded-2xl bg-surface p-4 text-[13px] leading-relaxed text-white/80">
            写真は端末内だけで処理され、外部のサーバーへ送信されることはありません。アカウント登録・広告・アクセス解析はありません。
          </p>
        </section>
        <section>
          <Button variant="danger" className="w-full" onClick={() => setConfirm(true)}>
            すべてのデータを削除
          </Button>
        </section>
        <p className="pb-6 text-center text-[12px] text-muted">壁紙コラージュ v{__APP_VERSION__}</p>
      </main>
      <ConfirmDialog
        open={confirm}
        title="すべてのデータを削除しますか？"
        message="保存済みのプロジェクトと画像がすべて削除されます。元に戻せません。"
        confirmLabel="削除"
        danger
        onConfirm={clear}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
