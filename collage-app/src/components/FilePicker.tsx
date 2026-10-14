import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface FilePickerHandle {
  open: () => void;
}

/**
 * 画像選択用の非表示 input。
 * iOS では「写真ライブラリ」「写真を撮る」「ファイルを選択」から選べる。
 * accept="image/*" の場合、iOS は HEIC を自動で JPEG に変換して渡す。
 */
export const FilePicker = forwardRef<FilePickerHandle, { onFiles: (files: File[]) => void; multiple?: boolean }>(
  function FilePicker({ onFiles, multiple = true }, ref) {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({ open: () => input.current?.click() }));
    return (
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    );
  },
);
