import { test, expect } from "playwright/test";

test("replicas sync across actors", async ({ page, context }) => {
  const editorPage = await context.newPage();
  await Promise.all([
    page.goto("/test/playwright/index.html"),
    editorPage.goto("/test/playwright/index.html"),
  ]);

  const ownerData = await page.evaluate(async () => {
    const { Dacument } = await window.__dacumentReady;
    const { generateNonce } = await import("bytecodec");
    const { generateSignPair } = await import("zeyra");

    const actorId = generateNonce();
    const actorKeys = await generateSignPair();
    await Dacument.setActorInfo({
      id: actorId,
      privateKeyJwk: actorKeys.signingJwk,
      publicKeyJwk: actorKeys.verificationJwk,
    });

    const schema = Dacument.schema({
      title: Dacument.register({ jsType: "string" }),
      body: Dacument.text(),
    });

    const created = await Dacument.create({ schema });
    const doc = await Dacument.load({
      schema,
      roleKey: created.roleKeys.owner.privateKey,
      snapshot: created.snapshot,
    });

    const ops = [];
    doc.addEventListener("delta", (event) => ops.push(...event.ops));
    window.__owner = { doc, ops, schema };

    return {
      snapshot: created.snapshot,
      roleKeys: created.roleKeys,
    };
  });

  const editorData = await editorPage.evaluate(async () => {
    const { Dacument } = await window.__dacumentReady;
    const { generateNonce } = await import("bytecodec");
    const { generateSignPair } = await import("zeyra");

    const actorId = generateNonce();
    const actorKeys = await generateSignPair();
    await Dacument.setActorInfo({
      id: actorId,
      privateKeyJwk: actorKeys.signingJwk,
      publicKeyJwk: actorKeys.verificationJwk,
    });

    const schema = Dacument.schema({
      title: Dacument.register({ jsType: "string" }),
      body: Dacument.text(),
    });

    window.__editor = { actorId, schema };
    return { actorId };
  });

  const ownerOps = await page.evaluate(async (editorId) => {
    const { doc, ops } = window.__owner;
    doc.acl.setRole(editorId, "editor");
    await doc.flush();
    const outbound = ops.slice();
    ops.length = 0;
    await doc.merge(outbound);
    await doc.flush();
    ops.length = 0;
    return outbound;
  }, editorData.actorId);

  await editorPage.evaluate(
    async ({ snapshot, roleKeys, ownerOps }) => {
      const { Dacument } = await window.__dacumentReady;
      const { schema } = window.__editor;
      const doc = await Dacument.load({
        schema,
        roleKey: roleKeys.editor.privateKey,
        snapshot,
      });
      const ops = [];
      doc.addEventListener("delta", (event) => ops.push(...event.ops));
      window.__editor.doc = doc;
      window.__editor.ops = ops;

      await doc.merge(ownerOps);
      await doc.flush();
      ops.length = 0;
    },
    { snapshot: ownerData.snapshot, roleKeys: ownerData.roleKeys, ownerOps }
  );

  const editorOps = await editorPage.evaluate(async () => {
    const { doc, ops } = window.__editor;
    doc.title = "hello";
    doc.body.insertAt(0, "H");
    await doc.flush();
    const outbound = ops.slice();
    ops.length = 0;
    return outbound;
  });

  expect(editorOps.length).toBeGreaterThan(0);

  const result = await page.evaluate(async (ops) => {
    const { doc } = window.__owner;
    await doc.merge(ops);
    await doc.flush();
    return {
      title: doc.title,
      body: doc.body.toString(),
    };
  }, editorOps);

  expect(result.title).toBe("hello");
  expect(result.body).toBe("H");
});
