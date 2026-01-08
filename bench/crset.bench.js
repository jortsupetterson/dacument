import { performance } from "node:perf_hooks";
import { CRSet } from "../dist/CRSet/class.js";

const RUNS = Number(process.env.RUNS ?? 3);
const SIZE = Number(process.env.SIZE ?? 20000);
const READS = Number(process.env.READS ?? Math.min(5000, SIZE));
const MERGE_SIZE = Number(process.env.MERGE_SIZE ?? Math.min(5000, SIZE));

const READ_COUNT = Math.min(READS, SIZE);
const MERGE_COUNT = Math.min(MERGE_SIZE, SIZE);

function bench(name, fn) {
  fn();
  const times = [];
  for (let index = 0; index < RUNS; index++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
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

console.log(
  `CRSet bench (runs=${RUNS}, size=${SIZE}, reads=${READ_COUNT}, mergeSize=${MERGE_COUNT})`
);

bench("CRSet add", () => {
  const set = new CRSet();
  for (let i = 0; i < SIZE; i++) set.add(`v${i}`);
});

bench("Set add", () => {
  const set = new Set();
  for (let i = 0; i < SIZE; i++) set.add(`v${i}`);
});

const base = new CRSet();
for (let i = 0; i < SIZE; i++) base.add(`v${i}`);
const baseSnapshot = structuredClone(base.snapshot());

const baseSet = new Set();
for (let i = 0; i < SIZE; i++) baseSet.add(`v${i}`);

bench("CRSet has", () => {
  let count = 0;
  for (let i = 0; i < READ_COUNT; i++)
    if (base.has(`v${i % SIZE}`)) count++;
  if (count === -1) console.log(count);
});

bench("Set has", () => {
  let count = 0;
  for (let i = 0; i < READ_COUNT; i++)
    if (baseSet.has(`v${i % SIZE}`)) count++;
  if (count === -1) console.log(count);
});

bench("CRSet delete", () => {
  const set = new CRSet({ snapshot: baseSnapshot });
  for (let i = 0; i < READ_COUNT; i++) set.delete(`v${i % SIZE}`);
});

bench("Set delete", () => {
  const set = new Set(baseSet);
  for (let i = 0; i < READ_COUNT; i++) set.delete(`v${i % SIZE}`);
});

const mergeLeft = new CRSet();
const mergeRight = new CRSet();
for (let i = 0; i < MERGE_COUNT; i++) {
  mergeLeft.add(`l${i}`);
  mergeRight.add(`r${i}`);
}
const mergeLeftSnapshot = structuredClone(mergeLeft.snapshot());
const mergeRightSnapshot = structuredClone(mergeRight.snapshot());

bench("CRSet merge", () => {
  const local = new CRSet({ snapshot: mergeLeftSnapshot });
  local.merge(mergeRightSnapshot);
});
