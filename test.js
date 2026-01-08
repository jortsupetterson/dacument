import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { CRArray } from "./dist/CRArray/class.js";
import { CRRegister } from "./dist/CRRegister/class.js";
import { CRText } from "./dist/CRText/class.js";

const WIDTH = 52;
const SPEED = Number(process.env.SPEED ?? 2);
const RENDER_INTERVAL = Math.max(80, Math.round(80 * SPEED));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scale(ms) {
  return Math.max(1, Math.round(ms * SPEED));
}

function truncate(text, width) {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function pad(text, width) {
  return truncate(text, width).padEnd(width, " ");
}

function formatChecklist(items) {
  if (!items || items.length === 0) return "(empty)";
  const shown = items.slice(0, 3).join(", ");
  const extra = items.length > 3 ? ` +${items.length - 3} more` : "";
  return `${shown}${extra}`;
}

if (isMainThread) {
  const workers = new Map();
  const states = new Map();
  const actionLog = [];
  let renderTimer = null;

  const emptyState = { title: "", description: "", checklist: [], completed: null };

  function formatCompleted(value) {
    if (value === true) return "yes";
    if (value === false) return "no";
    return "unset";
  }

  function formatCard(label, state) {
    const checklist = Array.isArray(state.checklist) ? state.checklist : [];
    return [
      `[${label}]`,
      `Title: ${truncate(state.title ?? "", WIDTH - 7)}`,
      `Desc : ${truncate(state.description ?? "", WIDTH - 7)}`,
      `List : ${truncate(formatChecklist(checklist), WIDTH - 7)}`,
      `Done : ${formatCompleted(state.completed)}`,
      `Lens : title ${String(state.title ?? "").length}, desc ${
        String(state.description ?? "").length
      }, items ${checklist.length}`,
    ];
  }

  function render() {
    renderTimer = null;
    const stateA = states.get("A") ?? emptyState;
    const stateB = states.get("B") ?? emptyState;
    const left = formatCard("Node A", stateA);
    const right = formatCard("Node B", stateB);
    const rows = [];
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max; i++) {
      rows.push(`${pad(left[i] ?? "", WIDTH)} | ${pad(right[i] ?? "", WIDTH)}`);
    }

    const logLines = actionLog.slice(-6).map((entry) => `- ${entry}`);

    const output = [
      "TODO Sync Simulator (CRText + CRArray + CRRegister)",
      `Updates: ${actionLog.length}, Nodes: A/B`,
      `Last: ${actionLog[actionLog.length - 1] ?? "waiting..."}`,
      "",
      ...rows,
      "",
      "Event log:",
      ...logLines,
    ];

    console.clear();
    console.log(output.join("\n"));
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(render, RENDER_INTERVAL);
  }

  function pushLog(entry) {
    actionLog.push(entry);
    if (actionLog.length > 12) actionLog.shift();
  }

  function relayPatch(fromId, patch) {
    for (const [id, worker] of workers.entries()) {
      if (id === fromId) continue;
      const delay = scale(40 + Math.floor(Math.random() * 140));
      const payload = {
        type: "patch",
        from: fromId,
        field: patch.field,
        nodes: patch.nodes,
      };
      setTimeout(() => worker.postMessage(payload), delay);
      const count = patch.nodes ? patch.nodes.length : 0;
      pushLog(
        `relay ${fromId} -> ${id} ${patch.field} ops=${count} delay=${delay}ms`
      );
    }
  }

  function onMessage(id, msg) {
    if (msg.type === "patch") {
      relayPatch(id, msg);
      scheduleRender();
      return;
    }

    if (msg.type === "state") {
      states.set(id, msg.state);
      pushLog(msg.action);
      scheduleRender();
      return;
    }

    if (msg.type === "done") {
      doneCount += 1;
      if (doneCount >= workers.size) {
        setTimeout(() => process.exit(0), 800);
      }
    }
  }

  function spawn(id) {
    const worker = new Worker(new URL(import.meta.url), {
      type: "module",
      workerData: { id },
    });
    workers.set(id, worker);
    worker.on("message", (msg) => onMessage(id, msg));
    worker.on("error", (err) => {
      pushLog(`${id} error: ${err.message}`);
      scheduleRender();
    });
  }

  let doneCount = 0;
  spawn("A");
  spawn("B");
  scheduleRender();
} else {
  const { id } = workerData;

  const title = new CRText();
  const description = new CRText();
  const checklist = new CRArray();
  const completed = new CRRegister();

  let suppressBroadcast = false;

  function snapshotState() {
    return {
      title: title.toString(),
      description: description.toString(),
      checklist: [...checklist],
      completed: completed.get(),
    };
  }

  function sendState(action) {
    parentPort.postMessage({ type: "state", id, action, state: snapshotState() });
  }

  function sendPatch(field, nodes) {
    parentPort.postMessage({ type: "patch", id, field, nodes });
  }

  function wireText(field, doc) {
    doc.onChange((nodes) => {
      if (suppressBroadcast) return;
      sendPatch(field, nodes);
      sendState(`${id} local ${field} nodes=${nodes.length}`);
    });
  }

  function wireArray(field, doc) {
    doc.onChange((nodes) => {
      if (suppressBroadcast) return;
      sendPatch(field, nodes);
      sendState(`${id} local ${field} nodes=${nodes.length}`);
    });
  }

  function wireRegister(field, doc) {
    doc.onChange((nodes) => {
      if (suppressBroadcast) return;
      sendPatch(field, nodes);
      sendState(`${id} local ${field} value=${String(nodes[0].value)}`);
    });
  }

  wireText("title", title);
  wireText("description", description);
  wireArray("checklist", checklist);
  wireRegister("completed", completed);

  parentPort.on("message", (msg) => {
    if (msg.type !== "patch") return;
    const target =
      msg.field === "title"
        ? title
        : msg.field === "description"
          ? description
          : msg.field === "checklist"
            ? checklist
            : completed;
    suppressBroadcast = true;
    if (msg.nodes) target.merge(msg.nodes);
    suppressBroadcast = false;
    const count = msg.nodes ? msg.nodes.length : 0;
    sendState(`${id} merged ${count} ${msg.field} op(s) from ${msg.from}`);
  });

  function step(delayMs, run) {
    return { delayMs: scale(delayMs), run };
  }

  async function runPlan(steps) {
    for (const item of steps) {
      await sleep(item.delayMs);
      await item.run();
    }
  }

  function tokenize(text) {
    const raw = text.match(/\S+\s*/g) ?? [];
    return raw.map((token) => (token.endsWith(" ") ? token : `${token} `));
  }

  async function typeText(doc, text, delayMs) {
    for (const token of tokenize(text)) {
      doc.insertAt(doc.length, token);
      await sleep(scale(delayMs));
    }
  }

  function addItem(text) {
    checklist.push(text);
  }

  function updateItem(index, text) {
    if (index < checklist.length) checklist.setAt(index, text);
    else checklist.push(text);
  }

  function removeLast() {
    checklist.pop();
  }

  function setCompleted(value) {
    completed.set(value);
  }

  function planA() {
    return [
      step(60, () => typeText(title, "TODO: Grocery list", 40)),
      step(120, () => typeText(description, "Remember to buy ", 40)),
      step(120, () => typeText(description, "milk and eggs", 40)),
      step(120, () => addItem("milk")),
      step(80, () => addItem("eggs")),
      step(120, () => updateItem(1, "eggs (x2)")),
      step(120, () => setCompleted(false)),
      step(120, () => typeText(description, " and fruit", 40)),
      step(200, () => setCompleted(true)),
    ];
  }

  function planB() {
    return [
      step(140, () => typeText(description, "Also get ", 40)),
      step(120, () => typeText(description, "bread", 40)),
      step(100, () => typeText(description, " and butter", 40)),
      step(120, () => addItem("bread")),
      step(80, () => addItem("butter")),
      step(120, () => updateItem(0, "bread (rye)")),
      step(120, () => removeLast()),
      step(160, () => setCompleted(false)),
    ];
  }

  const plan = id === "A" ? planA() : planB();
  sendState(`${id} ready`);

  runPlan(plan)
    .then(() => sleep(scale(800)))
    .then(() => {
      sendState(`${id} done`);
      parentPort.postMessage({ type: "done", id });
    })
    .catch((err) => {
      parentPort.postMessage({ type: "done", id, error: err.message });
    });
}
