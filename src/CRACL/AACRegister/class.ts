import { AccessDocument } from "../AccessDocument/class.js";
import type { AccessDocumentJSON } from "../class.js";

export class ACL {
  constructor(documents?: AccessDocumentJSON[]);
  add(document: AccessDocumentJSON): void;
  grants(subject: string, action: Permission): boolean;
  toJSON(): AccessDocumentJSON[];
}

export class ACL {
  private entries: Map<string, AccessDocument>;

  constructor(documents: AccessDocumentJSON) {
    this.entries = new Map();
    for (const data of documents) {
      const doc = new AccessDocument(data);
      this.entries.set(doc.sub, doc);
    }
  }

  /**
   * @param {import("../../types").AccessDocumentJSON} document
   */
  add(document) {
    const doc = new AccessDocument(document);
    this.entries.set(doc.sub, doc);
  }

  /**
   * @param {string} subject
   * @param {string} action
   * @returns {boolean}
   */
  grants(subject, action) {
    const doc = this.entries.get(subject);
    return doc ? doc.grants(action) : false;
  }

  /**
   *
   * @returns {Array<import("../../types").AccessDocumentJSON>}
   */
  toJSON() {
    return [...this.entries.values()].map((doc) => doc.toJSON());
  }
}
