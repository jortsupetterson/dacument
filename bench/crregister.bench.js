import { performance } from "node:perf_hooks";
import { CRRegister } from "../dist/CRRegister/class.js";

const RUNS = Number(process.env.RUNS ?? 3);
const SIZE = Number(process.env.SIZE ?? 100000);

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

function stamp(i) {
  return { wallTimeMs: i, logical: 0, clockId: "A" };
}

console.log(`CRRegister bench (runs=${RUNS}, size=${SIZE})`);

bench("CRRegister set (local)", () => {
  const reg = new CRRegister();
  for (let i = 0; i < SIZE; i++) reg.set((i & 1) === 0);
});

bench("CRRegister set (remote stamp)", () => {
  const reg = new CRRegister();
  for (let i = 0; i < SIZE; i++) reg.set((i & 1) === 0, stamp(i));
});

bench("Plain assignment", () => {
  let value = false;
  for (let i = 0; i < SIZE; i++) value = (i & 1) === 0;
  if (value) console.log(value);
});
