import { Dacument, type DacumentDoc } from "../src/index.js";

const schema = Dacument.schema({
  flag: Dacument.register({ jsType: "boolean" }),
  title: Dacument.register({ jsType: "string" }),
  notes: Dacument.text(),
  items: Dacument.array({ jsType: "number" }),
  tags: Dacument.set({ jsType: "string" }),
  props: Dacument.map({ jsType: "number" }),
  meta: Dacument.record({ jsType: "string" }),
});

type Doc = DacumentDoc<typeof schema>;

declare const doc: Doc;

doc.flag = true;
doc.title = "hello";
doc.notes.insertAt(0, "x");
doc.items.push(1);
doc.tags.add("tag");
doc.props.set("k", 1);
doc.meta.foo = "bar";

// @ts-expect-error register expects boolean
doc.flag = "no";
// @ts-expect-error register expects string
doc.title = 1;
// @ts-expect-error text fields are readonly
doc.notes = "nope";
// @ts-expect-error text view expects string
doc.notes.insertAt(0, 1);
// @ts-expect-error array element type mismatch
doc.items.push("x");
// @ts-expect-error arrays are readonly at field level
doc.items = [1];
// @ts-expect-error set element type mismatch
doc.tags.add(1);
// @ts-expect-error set fields are readonly at field level
doc.tags = new Set(["tag"]);
// @ts-expect-error map value type mismatch
doc.props.set("k", "x");
// @ts-expect-error map fields are readonly at field level
doc.props = new Map();
// @ts-expect-error record value type mismatch
doc.meta.foo = 1;
// @ts-expect-error record fields are readonly at field level
doc.meta = { foo: "bar" };
