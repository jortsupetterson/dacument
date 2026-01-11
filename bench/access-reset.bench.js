import { performance } from "node:perf_hooks";
import { generateNonce } from "bytecodec";
import { generateSignPair } from "zeyra";
import { Dacument } from "../dist/index.js";

const RUNS = Number(process.env.RUNS ?? 3);
const OPS = Number(process.env.OPS ?? 2000);

const actorId = generateNonce();
const actorKeys = await generateSignPair();
await Dacument.setActorInfo({
  id: actorId,
  privateKeyJwk: actorKeys.signingJwk,
  publicKeyJwk: actorKeys.verificationJwk,
});

const schema = Dacument.schema({
  title: Dacument.register({ jsType: "string" }),
  items: Dacument.array({ jsType: "string" }),
});

const { snapshot, roleKeys } = await Dacument.create({ schema });

const writer = await Dacument.load({
  schema,
  roleKey: roleKeys.owner.privateKey,
  snapshot,
});

const emitted = [];
writer.addEventListener("change", (event) => emitted.push(...event.ops));
for (let i = 0; i < OPS; i++) {
  writer.title = `t${i}`;
  writer.items.push(`item-${i}`);
}
await writer.flush();
const opBatch = emitted.slice();

async function benchAsync(name, fn) {
  await fn();
  const times = [];
  for (let index = 0; index < RUNS; index++) {
    const time = await fn();
    times.push(time);
  }
  const total = times.reduce((sum, value) => sum + value, 0);
  const avg = total / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(
    `${name}: avg ${avg.toFixed(2)} ms (min ${min.toFixed(
      2
    )}, max ${max.toFixed(2)})`
  );
}

console.log(`Dacument access reset bench (runs=${RUNS}, ops=${OPS})`);

await benchAsync("merge baseline (no reset)", async () => {
  const peer = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot,
  });
  const start = performance.now();
  await peer.merge(opBatch);
  return performance.now() - start;
});

await benchAsync("accessReset", async () => {
  const doc = await Dacument.load({
    schema,
    roleKey: roleKeys.owner.privateKey,
    snapshot,
  });
  await doc.merge(opBatch);
  const start = performance.now();
  await doc.accessReset({ reason: "bench" });
  return performance.now() - start;
});
