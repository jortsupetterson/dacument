import { test, expect } from "playwright/test";

test("delta events carry ops and merge updates state", async ({ page }) => {
  await page.goto("/test/playwright/index.html");

  const result = await page.evaluate(async () => {
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
      flag: Dacument.register({ jsType: "boolean" }),
      body: Dacument.text(),
      tags: Dacument.set({ jsType: "string" }),
    });

    const created = await Dacument.create({ schema });
    const doc = await Dacument.load({
      schema,
      roleKey: created.roleKeys.owner.privateKey,
      snapshot: created.snapshot,
    });

    const eventTypes = [];
    const ops = [];
    doc.addEventListener("delta", (event) => {
      eventTypes.push(event.type);
      ops.push(...event.ops);
    });

    doc.flag = true;
    doc.body.insertAt(0, "A");
    doc.tags.add("one");
    await doc.flush();

    const outbound = ops.slice();
    ops.length = 0;

    const mergeResult = await doc.merge(outbound);
    await doc.flush();

    return {
      eventTypes,
      outboundCount: outbound.length,
      mergeAccepted: mergeResult.accepted.length,
      flag: doc.flag,
      body: doc.body.toString(),
      tags: Array.from(doc.tags.values()),
    };
  });

  expect(result.eventTypes.every((type) => type === "delta")).toBe(true);
  expect(result.outboundCount).toBeGreaterThan(0);
  expect(result.mergeAccepted).toBeGreaterThan(0);
  expect(result.flag).toBe(true);
  expect(result.body).toBe("A");
  expect(result.tags).toEqual(["one"]);
});
