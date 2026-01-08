import { performance } from "node:perf_hooks";
import { CRText } from "../dist/CRText/class.js";

const RUNS = Number(process.env.RUNS ?? 3);
const SIZE = Number(process.env.SIZE ?? 2000);
const MID_OPS = Number(process.env.MID_OPS ?? Math.min(500, SIZE));
const READS = Number(process.env.READS ?? Math.min(1000, SIZE));
const MERGE_SIZE = Number(process.env.MERGE_SIZE ?? Math.min(1000, SIZE));

const MID_COUNT = Math.min(MID_OPS, SIZE);
const READ_COUNT = Math.min(READS, SIZE);
const MERGE_COUNT = Math.min(MERGE_SIZE, SIZE);

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function charAt(index) {
  return ALPHABET[index % ALPHABET.length];
}

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

function buildCRText(size) {
  const text = new CRText();
  for (let i = 0; i < size; i++) text.insertAt(text.length, charAt(i));
  return text;
}

function buildArray(size) {
  const arr = [];
  for (let i = 0; i < size; i++) arr.push(charAt(i));
  return arr;
}

console.log(
  `CRText bench (runs=${RUNS}, size=${SIZE}, midOps=${MID_COUNT}, reads=${READ_COUNT}, mergeSize=${MERGE_COUNT})`
);

bench("CRText insertAt append", () => {
  const text = new CRText();
  for (let i = 0; i < SIZE; i++) text.insertAt(text.length, charAt(i));
});

bench("Array insert append", () => {
  const arr = [];
  for (let i = 0; i < SIZE; i++) arr.push(charAt(i));
});

const baseText = buildCRText(SIZE);
const baseArray = buildArray(SIZE);

bench("CRText toString", () => {
  baseText.toString();
});

bench("Array join", () => {
  baseArray.join("");
});

bench("CRText insertAt middle", () => {
  const text = new CRText(structuredClone(baseText.snapshot()));
  for (let i = 0; i < MID_COUNT; i++)
    text.insertAt(Math.floor(text.length / 2), charAt(i));
});

bench("Array insert middle", () => {
  const arr = baseArray.slice();
  for (let i = 0; i < MID_COUNT; i++)
    arr.splice(Math.floor(arr.length / 2), 0, charAt(i));
});

bench("CRText deleteAt middle", () => {
  const text = new CRText(structuredClone(baseText.snapshot()));
  for (let i = 0; i < MID_COUNT; i++)
    text.deleteAt(Math.floor(text.length / 2));
});

bench("Array delete middle", () => {
  const arr = baseArray.slice();
  for (let i = 0; i < MID_COUNT; i++)
    arr.splice(Math.floor(arr.length / 2), 1);
});

bench("CRText index read", () => {
  let output = "";
  for (let i = 0; i < READ_COUNT; i++)
    output += baseText.at(i % baseText.length) ?? "";
  if (output === "sentinel") console.log(output);
});

bench("Array index read", () => {
  let output = "";
  for (let i = 0; i < READ_COUNT; i++)
    output += baseArray[i % baseArray.length];
  if (output === "sentinel") console.log(output);
});

const mergeLeft = buildCRText(MERGE_COUNT);
const mergeRight = buildCRText(MERGE_COUNT);
const mergeLeftSnapshot = structuredClone(mergeLeft.snapshot());
const mergeRightSnapshot = structuredClone(mergeRight.snapshot());

bench("CRText merge", () => {
  const local = new CRText(structuredClone(mergeLeftSnapshot));
  local.merge(mergeRightSnapshot);
});
