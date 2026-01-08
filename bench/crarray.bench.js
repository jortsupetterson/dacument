import { performance } from "node:perf_hooks";
import { CRArray } from "../dist/index.js";

const RUNS = Number(process.env.RUNS ?? 3);
const SIZE = Number(process.env.SIZE ?? 5000);
const READS = Number(process.env.READS ?? Math.min(SIZE, 1000));
const WRITES = Number(process.env.WRITES ?? Math.min(SIZE, 500));
const MERGE_SIZE = Number(process.env.MERGE_SIZE ?? Math.min(SIZE, 2000));

const READ_COUNT = Math.min(READS, SIZE);
const WRITE_COUNT = Math.min(WRITES, SIZE);
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
  `CRArray bench (runs=${RUNS}, size=${SIZE}, reads=${READ_COUNT}, writes=${WRITE_COUNT}, mergeSize=${MERGE_COUNT})`
);

bench("CRArray push", () => {
  const cr = new CRArray();
  for (let i = 0; i < SIZE; i++) cr.push(i);
});

bench("Array push", () => {
  const arr = [];
  for (let i = 0; i < SIZE; i++) arr.push(i);
});

const crForIter = new CRArray();
for (let i = 0; i < SIZE; i++) crForIter.push(i);
const arrForIter = Array.from({ length: SIZE }, (_, i) => i);

bench("CRArray iterate", () => {
  let total = 0;
  for (const value of crForIter) total += value;
  if (total === -1) console.log(total);
});

bench("Array iterate", () => {
  let total = 0;
  for (const value of arrForIter) total += value;
  if (total === -1) console.log(total);
});

bench("CRArray index read (proxy)", () => {
  let total = 0;
  for (let i = 0; i < READ_COUNT; i++) total += crForIter[i];
  if (total === -1) console.log(total);
});

bench("Array index read", () => {
  let total = 0;
  for (let i = 0; i < READ_COUNT; i++) total += arrForIter[i];
  if (total === -1) console.log(total);
});

bench("CRArray index write (proxy)", () => {
  const cr = new CRArray(structuredClone(crForIter.snapshot()));
  for (let i = 0; i < WRITE_COUNT; i++) cr[i] = -i;
});

bench("Array index write", () => {
  const arr = arrForIter.slice();
  for (let i = 0; i < WRITE_COUNT; i++) arr[i] = -i;
});

bench("CRArray pop", () => {
  const cr = new CRArray(structuredClone(crForIter.snapshot()));
  while (cr.length > 0) cr.pop();
});

bench("Array pop", () => {
  const arr = arrForIter.slice();
  while (arr.length > 0) arr.pop();
});

const mergeLeft = new CRArray();
const mergeRight = new CRArray();
for (let i = 0; i < MERGE_COUNT; i++) {
  mergeLeft.push(i);
  mergeRight.push(i + MERGE_COUNT);
}
const mergeLeftSnapshot = structuredClone(mergeLeft.snapshot());
const mergeRightSnapshot = structuredClone(mergeRight.snapshot());

bench("CRArray merge", () => {
  const local = new CRArray(structuredClone(mergeLeftSnapshot));
  local.merge(mergeRightSnapshot);
});
