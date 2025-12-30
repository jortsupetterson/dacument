import type { RGAIndex, RGASnapshot } from "./RGASnapshot";
import { RGATree } from "./RGATree";
type MWStringEvent = "merged" | "inserted" | "deleted";
type MWStringEventListener = () => void;

export class MWString {
  private tree: RGATree;
  private visibleIds: Array<RGAIndex>;
  private listeners = new Map<MWStringEvent, Set<MWStringEventListener>>();

  constructor(snapshot: RGASnapshot) {
    this.tree = new RGATree(snapshot);
    this.visibleIds = this.tree.materialize().visibleIds;
  }

  private emit(type: MWStringEvent): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of set) listener();
  }

  addEventListener(type: MWStringEvent, listener: MWStringEventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: MWStringEvent,
    listener: MWStringEventListener
  ): void {
    const set = this.listeners.get(type);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(type);
  }

  insert(index: number, character: string): void {
    if (typeof character !== "string") {
      throw new Error(
        "{MWString} `character` parameter of `insert` method MUST be typeof `string`"
      );
    }
    this.visibleIds[index];
    // apply insert op → rebuild tree
    this.emit("inserted");
  }

  delete(index: number): void {
    this.tree.snapshot[this.visibleIds[index]].active = false;
    this.emit("deleted");
  }

  merge(remote: RGASnapshot): void {
    // merge snapshots → rebuild tree
    this.emit("merged");
  }

  print(): string {
    return this.tree.materialize().text;
  }
}
