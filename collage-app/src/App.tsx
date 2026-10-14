import { useEffect } from 'react';
import { ProjectGate } from './components/useProject';
import { Toasts } from './components/ui';
import { applyPendingUpdate } from './lib/pwa';
import { cleanupInterruptedImports } from './storage/backup';
import { useRoute } from './lib/router';
import { EditorScreen } from './screens/editor/EditorScreen';
import { ExportScreen } from './screens/ExportScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ImagesScreen } from './screens/ImagesScreen';
import { PreviewScreen } from './screens/PreviewScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useEditor } from './state/editorStore';

export function App() {
  const route = useRoute();

  // プロジェクト外の画面に移ったら、保存してメモリを解放。
  // 新しいバージョンが配信されていれば、保存が終わったこのタイミングで適用する
  useEffect(() => {
    if (route.name === 'home' || route.name === 'settings') {
      void useEditor
        .getState()
        .closeProject()
        .then(() => {
          if (route.name === 'home') applyPendingUpdate();
        });
    }
  }, [route.name]);

  // 前回、復元の途中でアプリが強制終了された場合の残骸を掃除する（既存プロジェクトには触れない）
  useEffect(() => {
    void cleanupInterruptedImports();
  }, []);

  // アプリが背面に回る・閉じられる直前に保存
  useEffect(() => {
    const flush = () => void useEditor.getState().flushSave();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  let screen: React.ReactNode;
  switch (route.name) {
    case 'home':
      screen = <HomeScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'images':
      screen = <ProjectGate projectId={route.projectId}>{() => <ImagesScreen projectId={route.projectId} />}</ProjectGate>;
      break;
    case 'editor':
      screen = <ProjectGate projectId={route.projectId}>{() => <EditorScreen projectId={route.projectId} />}</ProjectGate>;
      break;
    case 'preview':
      screen = <ProjectGate projectId={route.projectId}>{() => <PreviewScreen projectId={route.projectId} />}</ProjectGate>;
      break;
    case 'export':
      screen = <ProjectGate projectId={route.projectId}>{() => <ExportScreen projectId={route.projectId} />}</ProjectGate>;
      break;
  }

  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}
