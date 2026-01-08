import { performance } from "node:perf_hooks";
import { CRRecord } from "../dist/CRRecord/class.js";

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
  `CRRecord bench (runs=${RUNS}, size=${SIZE}, reads=${READ_COUNT}, mergeSize=${MERGE_COUNT})`
);

bench("CRRecord set", () => {
  const record = new CRRecord();
  for (let i = 0; i < SIZE; i++) record[`k${i}`] = i;
});

bench("Object set", () => {
  const record = {};
  for (let i = 0; i < SIZE; i++) record[`k${i}`] = i;
});

const base = new CRRecord();
for (let i = 0; i < SIZE; i++) base[`k${i}`] = i;
const baseSnapshot = structuredClone(base.snapshot());

const baseObj = {};
for (let i = 0; i < SIZE; i++) baseObj[`k${i}`] = i;

bench("CRRecord get", () => {
  let total = 0;
  for (let i = 0; i < READ_COUNT; i++)
    total += base[`k${i % SIZE}`] ?? 0;
  if (total === -1) console.log(total);
});

bench("Object get", () => {
  let total = 0;
  for (let i = 0; i < READ_COUNT; i++)
    total += baseObj[`k${i % SIZE}`] ?? 0;
  if (total === -1) console.log(total);
});

bench("CRRecord delete", () => {
  const record = new CRRecord(baseSnapshot);
  for (let i = 0; i < READ_COUNT; i++) delete record[`k${i % SIZE}`];
});

bench("Object delete", () => {
  const record = Object.assign({}, baseObj);
  for (let i = 0; i < READ_COUNT; i++) delete record[`k${i % SIZE}`];
});

const mergeLeft = new CRRecord();
const mergeRight = new CRRecord();
for (let i = 0; i < MERGE_COUNT; i++) {
  mergeLeft[`l${i}`] = i;
  mergeRight[`r${i}`] = i;
}
const mergeLeftSnapshot = structuredClone(mergeLeft.snapshot());
const mergeRightSnapshot = structuredClone(mergeRight.snapshot());

bench("CRRecord merge", () => {
  const local = new CRRecord(mergeLeftSnapshot);
  local.merge(mergeRightSnapshot);
});
