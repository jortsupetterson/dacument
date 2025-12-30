export class LIWRegister {
  constructor(value) {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.onLine !== "boolean"
    ) {
      throw new Error(
        "LIWRegister requires a UI environment with navigator.onLine available"
      );
    }

    this.value = value;
    this.online = navigator.onLine;
    this.timestamp = Date.now();
  }

  async resolveIntent(received) {
    const valueType = typeof this.value;

    if (
      valueType !== "string" &&
      valueType !== "number" &&
      valueType !== "boolean"
    ) {
      throw new Error(
        "Unsupported value type; only string, number, and boolean are allowed"
      );
    }

    if (typeof received.value !== valueType) {
      throw new Error("Incompatible values");
    }

    if (typeof this.onconflict !== "function") {
      throw new Error("Missing onconflict handler");
    }

    // Online + non-newer timestamp → explicit conflict resolution
    if (received.online && received.timestamp <= this.timestamp) {
      const merged = await this.onconflict(received, this);

      if (!(merged instanceof LIWRegister)) {
        throw new Error(
          "onconflict handler must return an instance of LIWRegister"
        );
      }

      return merged;
    }

    // Offline + non-newer timestamp → ignore as stale
    if (!received.online && received.timestamp <= this.timestamp) {
      return this;
    }

    // Default: accept received as newer intent
    return received;
  }

  /** @type {undefined | ((received: LIWRegister, stored: LIWRegister) => Promise<LIWRegister>)} */
  onconflict = undefined;
}
