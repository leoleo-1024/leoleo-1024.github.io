/** 編集履歴（操作列 + Redo 用スタック）。移動・ズームは含めない */
import type { Op } from './types';

export class History {
  private _ops: Op[] = [];
  private _redo: Op[] = [];
  private savedLastId = 0;

  get ops(): readonly Op[] {
    return this._ops;
  }
  get canUndo(): boolean {
    return this._ops.length > 0;
  }
  get canRedo(): boolean {
    return this._redo.length > 0;
  }
  /** 最後の操作の ID（操作 ID は再利用しないため、状態を一意に表す） */
  get lastId(): number {
    return this._ops.length ? this._ops[this._ops.length - 1].id : 0;
  }
  /** 最後に保存した状態から変更があるか */
  get dirty(): boolean {
    return this.lastId !== this.savedLastId;
  }

  push(op: Op): void {
    this._ops.push(op);
    this._redo = [];
  }

  /** 取り消した操作を返す */
  undo(): Op | null {
    const op = this._ops.pop();
    if (!op) return null;
    this._redo.push(op);
    return op;
  }

  /** やり直した操作を返す */
  redo(): Op | null {
    const op = this._redo.pop();
    if (!op) return null;
    this._ops.push(op);
    return op;
  }

  markSaved(): void {
    this.savedLastId = this.lastId;
  }

  clear(): void {
    this._ops = [];
    this._redo = [];
    this.savedLastId = 0;
  }
}

let nextId = 1;
/** 操作 ID（アプリ起動中は一意） */
export function newOpId(): number {
  return nextId++;
}
