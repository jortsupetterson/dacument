import { LIWRegister } from "../LIWRegister/class";
import { MWString } from "../MWString/class";
import { ORACList } from "../ORACList/class";
export type CRDocumentField = {
  type: "LIW" | "MWS" | "ACL";
  snapshot: LIWRegister | MWString;
};
export type CRDocumentSnapshot = Record<string, CRDocumentField>;
export class CARHandler {
  constructor(snapshot: CRDocumentSnapshot) {
    for (const key of Object.keys(snapshot)) {
      const field = snapshot[key];
      switch (field.type) {
        case "LIW":
          this[key] = new LIWRegister(field.snapshot);
        case "MWS":
          this[key] = new MWString(field.snapshot);
        case "ACL":
          this[key] = new ORACList(field.snapshot);
      }
    }
  }
}
