import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getEditor, openFile, subscribeEditor } from './editor/session';
import { store } from './state/store';
import { EditorScreen } from './ui/EditorScreen';
import { FilePicker, type FilePickerHandle } from './ui/FilePicker';
import { BusyOverlay, DialogHost, ToastHost } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';

export function App() {
  const picker = useRef<FilePickerHandle>(null);
  const editor = useSyncExternalStore(subscribeEditor, getEditor);

  useEffect(() => {
    // 保存していない編集があるときはページを閉じる前に確認
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.get().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /** 新しい写真を開く（未保存の編集があれば確認） */
  const requestOpen = () => {
    if (store.get().dirty) {
      store.set({
        dialog: {
          title: '保存していない編集があります',
          message: '編集内容を破棄して、新しい写真を開きますか？',
          actions: [
            { label: 'キャンセル', kind: 'cancel' },
            { label: '破棄して開く', kind: 'danger', onSelect: () => picker.current?.open() },
          ],
        },
      });
      return;
    }
    picker.current?.open();
  };

  return (
    <>
      <FilePicker ref={picker} onFile={openFile} />
      {editor ? <EditorScreen key={editor.name + editor.width} editor={editor} onOpen={requestOpen} /> : <StartScreen onOpen={requestOpen} />}
      <BusyOverlay />
      <DialogHost />
      <ToastHost />
    </>
  );
}
