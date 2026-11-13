export type ExportFormat = 'jpeg' | 'png';

export type EncodeRequest =
  | { type: 'start'; format: ExportFormat; width: number; height: number; quality: number; hasAlpha: boolean }
  | { type: 'rows'; data: ArrayBuffer; rows: number }
  | { type: 'finish' };

export type EncodeResponse = { type: 'ack' } | { type: 'done'; blob: Blob } | { type: 'error'; message: string };
