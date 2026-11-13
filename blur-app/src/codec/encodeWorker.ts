/// <reference lib="webworker" />
/** 書き出し用エンコーダーの Worker（メインスレッドの操作を妨げないよう符号化をここで行う） */
import { JpegEncoder } from './jpeg';
import { PngEncoder } from './png';
import type { EncodeRequest, EncodeResponse } from './protocol';

let jpeg: JpegEncoder | null = null;
let png: PngEncoder | null = null;
let mime = 'image/jpeg';
let queue: Promise<void> = Promise.resolve();

const post = (m: EncodeResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  const msg = e.data;
  queue = queue
    .then(async () => {
      if (msg.type === 'start') {
        mime = msg.format === 'png' ? 'image/png' : 'image/jpeg';
        jpeg = msg.format === 'jpeg' ? new JpegEncoder(msg.width, msg.height, msg.quality) : null;
        png = msg.format === 'png' ? new PngEncoder(msg.width, msg.height, msg.hasAlpha) : null;
      } else if (msg.type === 'rows') {
        const data = new Uint8ClampedArray(msg.data);
        if (jpeg) jpeg.addRows(data, msg.rows);
        else if (png) await png.addRows(data, msg.rows);
        post({ type: 'ack' });
      } else if (msg.type === 'finish') {
        const parts = jpeg ? jpeg.finish() : await png!.finish();
        jpeg = null;
        png = null;
        post({ type: 'done', blob: new Blob(parts as BlobPart[], { type: mime }) });
      }
    })
    .catch((err: unknown) => {
      jpeg = null;
      png = null;
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
};
