import { performance } from "node:perf_hooks";
import { CRMap } from "../dist/CRMap/class.js";

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
  `CRMap bench (runs=${RUNS}, size=${SIZE}, reads=${READ_COUNT}, mergeSize=${MERGE_COUNT})`
);

bench("CRMap set", () => {
  const map = new CRMap();
  for (let i = 0; i < SIZE; i++) map.set(`k${i}`, i);
});

bench("Map set", () => {
  const map = new Map();
  for (let i = 0; i < SIZE; i++) map.set(`k${i}`, i);
});

const base = new CRMap();
for (let i = 0; i < SIZE; i++) base.set(`k${i}`, i);
const baseSnapshot = structuredClone(base.snapshot());

const baseMap = new Map();
for (let i = 0; i < SIZE; i++) baseMap.set(`k${i}`, i);

bench("CRMap get", () => {
  let total = 0;
  for (let i = 0; i < READ_COUNT; i++)
    total += base.get(`k${i % SIZE}`) ?? 0;
  if (total === -1) console.log(total);
});

bench("Map get", () => {
  let total = 0;
  for (let i = 0; i < READ_COUNT; i++)
    total += baseMap.get(`k${i % SIZE}`) ?? 0;
  if (total === -1) console.log(total);
});

bench("CRMap delete", () => {
  const map = new CRMap({ snapshot: baseSnapshot });
  for (let i = 0; i < READ_COUNT; i++) map.delete(`k${i % SIZE}`);
});

bench("Map delete", () => {
  const map = new Map(baseMap);
  for (let i = 0; i < READ_COUNT; i++) map.delete(`k${i % SIZE}`);
});

const mergeLeft = new CRMap();
const mergeRight = new CRMap();
for (let i = 0; i < MERGE_COUNT; i++) {
  mergeLeft.set(`l${i}`, i);
  mergeRight.set(`r${i}`, i);
}
const mergeLeftSnapshot = structuredClone(mergeLeft.snapshot());
const mergeRightSnapshot = structuredClone(mergeRight.snapshot());

bench("CRMap merge", () => {
  const local = new CRMap({ snapshot: mergeLeftSnapshot });
  local.merge(mergeRightSnapshot);
});
