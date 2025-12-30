import type { RGAIndex, RGASnapshot } from "./RGASnapshot";
export class RGATree {
  public snapshot: RGASnapshot;
  private children: Map<RGAIndex, RGAIndex[]> = new Map();
  static #root: RGAIndex = `\u0000#0` as RGAIndex;

  constructor(snapshot: RGASnapshot) {
    this.snapshot = snapshot;

    for (const [id, node] of Object.entries(snapshot)) {
      const parent = node.after;
      let list = this.children.get(parent);
      if (!list) {
        list = [];
        this.children.set(parent, list);
      }
      list.push(id as RGAIndex);
    }

    for (const list of this.children.values()) {
      list.sort();
    }
  }

  materialize(): { text: string; visibleIds: RGAIndex[] } {
    let text = "";
    const visibleIds: RGAIndex[] = [];

    const dfs = (id: RGAIndex) => {
      const children = this.children.get(id);
      if (!children) return;

      for (const childId of children) {
        const node = this.snapshot[childId];
        if (node.active) {
          text += node.character;
          visibleIds.push(childId);
        }
        dfs(childId);
      }
    };

    dfs(RGATree.#root);
    return { text, visibleIds };
  }
}
