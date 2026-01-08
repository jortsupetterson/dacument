export class AccessDocument {
  constructor(data: AccessDocumentJSON);
  sub: string;
  permissions: Set<Permission>;
  grants(action: Permission): boolean;
  toJSON(): AccessDocumentJSON;
}

export class AccessDocument {
  /**
   * @param {import("..").AccessDocumentJSON} data
   */
  constructor(data) {
    this.sub = data.sub;
    this.permissions = new Set(data.permissions);
  }

  /**
   * @param {string} action
   * @returns {boolean}
   */
  grants(action) {
    return this.permissions.has(action);
  }

  toJSON() {
    return { sub: this.sub, permissions: [...this.permissions] };
  }
}
