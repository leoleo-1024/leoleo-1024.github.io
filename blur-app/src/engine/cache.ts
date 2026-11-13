/** バイト数の上限つき LRU キャッシュ（Map の挿入順を利用） */
export class TileCache<T extends { byteLength: number } = Uint8Array | Uint8ClampedArray> {
  private map = new Map<string, T | null>();
  private bytes = 0;

  constructor(public budget: number) {}

  get size(): number {
    return this.map.size;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** 値（null = 「空」として記録済み）を返す。未登録は undefined */
  get(key: string): T | null | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: T | null): void {
    this.delete(key);
    this.map.set(key, value);
    this.bytes += value ? value.byteLength : 0;
    if (this.bytes > this.budget) this.evict();
  }

  delete(key: string): void {
    const v = this.map.get(key);
    if (v === undefined) return;
    this.map.delete(key);
    this.bytes -= v ? v.byteLength : 0;
  }

  deletePrefix(prefix: string): void {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.delete(k);
  }

  forEachKey(fn: (k: string) => void): void {
    for (const k of this.map.keys()) fn(k);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  private evict(): void {
    // 古いものから、上限の 85% まで減らす
    const target = this.budget * 0.85;
    for (const k of this.map.keys()) {
      if (this.bytes <= target) break;
      this.delete(k);
    }
  }
}
