import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface FilePickerHandle {
  open: () => void;
}

/**
 * 写真選択用の非表示 input。
 * iOS では「写真ライブラリ」「写真を撮る」「ファイルを選択」から選べ、HEIC は自動で JPEG に変換されて渡される。
 */
export const FilePicker = forwardRef<FilePickerHandle, { onFile: (file: File) => void }>(function FilePicker({ onFile }, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }));
  return (
    <input
      ref={input}
      type="file"
      accept="image/*,.heic,.heif"
      hidden
      data-testid="file-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onFile(f);
      }}
    />
  );
});
