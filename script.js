/* Resource Allocation Simulator – plain JavaScript (no libraries)
   1. helpers   2. input & validation   3. algorithms (pure functions)
   4. rendering of steps / graph   5. performance & benchmark   6. events */

const $ = id => document.getElementById(id);
const letter = j => String.fromCharCode(65 + j);              // 0 -> A, 1 -> B ...

/* ===================== 1. helpers ===================== */
const leq = (a, b) => a.every((x, i) => x <= b[i]);          // a <= b for every resource type
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const fmt = v => "(" + v.join(", ") + ")";
const zeros = k => Array(k).fill(0);

// Average run time in microseconds (one run is too short to time, so repeat for ~15 ms).
function measure(fn) {
  let reps = 0; const t0 = performance.now();
  do { fn(); reps++; } while (performance.now() - t0 < 15);
  return (performance.now() - t0) / reps * 1000;
}

/* ===================== 2. input & validation ===================== */
let dims = { n: 0, m: 0 };                                   // size of the tables currently on screen

function showError(msg) { $("error").textContent = msg || ""; }

function buildTables(data) {
  const n = Number($("n").value), m = Number($("m").value);
  if (!Number.isInteger(n) || !Number.isInteger(m) || n < 1 || n > 10 || m < 1 || m > 6) {
    showError("Processes must be a whole number from 1 to 10 and resource types from 1 to 6."); return;
  }
  dims = { n, m }; showError("");
  let t = "<b>Total resources:</b>";
  for (let j = 0; j < m; j++) t += ` <label>${letter(j)} <input id="tot-${j}" type="number" min="0" value="0"></label>`;
  $("totals").innerHTML = t;
  const grid = (name, title, calc) => {
    let h = `<div class="mat ${calc ? "calc" : ""}"><b>${title}</b><table><tr><th></th>`;
    for (let j = 0; j < m; j++) h += `<th>${letter(j)}</th>`;
    h += "</tr>";
    for (let i = 0; i < n; i++) {
      h += `<tr><th>P${i}</th>`;
      for (let j = 0; j < m; j++)
        h += `<td><input id="${name}-${i}-${j}" type="number" min="0" value="0" ${calc ? "disabled" : ""}></td>`;
      h += "</tr>";
    }
    return h + "</table></div>";
  };
  $("matrices").innerHTML = grid("alloc", "Allocation") + grid("max", "Maximum") +
    grid("req", "Request (detection / graph)") + grid("need", "Need = Max − Alloc (calculated)", true);
  $("reqProc").innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}">P${i}</option>`).join("");
  if (data) data.total.forEach((v, j) => $("tot-" + j).value = v);
  if (data) data.alloc.forEach((r, i) => r.forEach((v, j) => {
    $(`alloc-${i}-${j}`).value = v; $(`max-${i}-${j}`).value = data.max[i][j]; $(`req-${i}-${j}`).value = data.req[i][j];
  }));
  refreshDerived();
}

function loadExample(d) {
  $("n").value = d.alloc.length; $("m").value = d.total.length;
  $("reqVec").value = d.request || "";
  if (d.request) $("reqProc").dataset.want = d.requestProc;
  buildTables(d);
  if (d.request) $("reqProc").value = d.requestProc;
  resetResults(); granted = 0; waiting = 0;
}

const EX_BANKER = { total: [10, 5, 7],
  alloc: [[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]],
  max:   [[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]],
  req:   [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]] };
const EX_DETECT = { total: [7, 2, 6],
  alloc: [[0,1,0],[2,0,0],[3,0,3],[2,1,1],[0,0,2]],
  req:   [[0,0,0],[2,0,2],[0,0,1],[1,0,0],[0,0,2]],
  max:   [[0,1,0],[4,0,2],[3,0,4],[3,1,1],[0,0,4]] };
// Printer (A) / scanner (B) example of the report: P1 holds A and wants B, P2 holds B and wants A.
const EX_GRAPH = { total: [1, 1],
  alloc: [[0,0],[1,0],[0,1]], req: [[0,0],[0,1],[1,0]], max: [[0,0],[1,1],[1,1]] };

// Read one matrix. Empty cell = 0. Anything that is not a whole number >= 0 is an error.
function readMatrix(name, n, m) {
  const M = [];
  for (let i = 0; i < n; i++) {
    M.push([]);
    for (let j = 0; j < m; j++) {
      const id = `${name}-${i}-${j}`, raw = $(id).value.trim(), x = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(x) || x < 0) throw fail(`Invalid value in the ${name} matrix at P${i}, ${letter(j)}: use a whole number ≥ 0.`, id);
      M[i].push(x);
    }
  }
  return M;
}
function fail(msg, cellId) { const e = new Error(msg); e.cell = cellId; return e; }

// Read all tables, validate them, and calculate Need and Available.
function readSystem() {
  document.querySelectorAll("input.bad").forEach(x => x.classList.remove("bad"));
  if (!dims.n) throw fail("Create the tables first.");
  const { n, m } = dims, total = [];
  for (let j = 0; j < m; j++) {
    const x = Number($("tot-" + j).value);
    if (!Number.isInteger(x) || x < 0) throw fail(`Invalid total for resource ${letter(j)}.`, "tot-" + j);
    total.push(x);
  }
  const alloc = readMatrix("alloc", n, m), max = readMatrix("max", n, m), req = readMatrix("req", n, m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++)
    if (alloc[i][j] > max[i][j]) throw fail(`Allocation is greater than Maximum for P${i}, resource ${letter(j)}.`, `alloc-${i}-${j}`);
  const used = zeros(m);
  alloc.forEach(r => r.forEach((v, j) => used[j] += v));
  for (let j = 0; j < m; j++)
    if (used[j] > total[j]) throw fail(`Total allocation of ${letter(j)} is ${used[j]} but only ${total[j]} exist.`, "tot-" + j);
  return { n, m, total, alloc, max, req, need: max.map((r, i) => sub(r, alloc[i])), avail: sub(total, used), used };
}

// Live update while typing. Calculate the derived tables even when the full
// system is temporarily inconsistent, then validate only when running an algorithm.
function refreshDerived() {
  try {
    document.querySelectorAll("input.bad").forEach(x => x.classList.remove("bad"));
    if (!dims.n) return;
    const { n, m } = dims, total = [];
    for (let j = 0; j < m; j++) {
      const raw = $("tot-" + j).value.trim();
      const value = raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        $("available").innerHTML = `<span class="hint">⚠ Enter a whole number ≥ 0 for total resource ${letter(j)}.</span>`;
        return;
      }
      total.push(value);
    }
    const alloc = readMatrix("alloc", n, m), max = readMatrix("max", n, m);
    const used = zeros(m);
    alloc.forEach(r => r.forEach((v, j) => used[j] += v));
    const need = max.map((r, i) => sub(r, alloc[i]));
    need.forEach((r, i) => r.forEach((v, j) => {
      const cell = $(`need-${i}-${j}`);
      if (cell) cell.value = v;
    }));
    const avail = sub(total, used);
    const warning = avail.some(v => v < 0)
      ? ` <span class="hint">⚠ Allocation exceeds total resources; correct the totals or allocations before running.</span>` : "";
    $("available").innerHTML = `<b>Available (calculated):</b> ${fmt(avail)}${warning}`;
    showError("");
  } catch (e) {
    $("available").innerHTML = `<span class="hint">⚠ ${e.message}</span>`;
  }
}

// Read the Banker's request fields. Returns null when the box is empty.
function readRequest(s) {
  const text = $("reqVec").value.trim();
  if (text === "") return null;
  const r = text.split(/[\s,]+/).map(Number);
  if (r.length !== s.m || r.some(x => !Number.isInteger(x) || x < 0))
    throw fail(`The request needs exactly ${s.m} whole numbers ≥ 0, e.g. ${Array(s.m).fill(1).join(",")}.`, "reqVec");
  return { i: Number($("reqProc").value), r };
}

/* ===================== 3. algorithms (pure: no DOM access) ===================== */
// The loop shared by Banker's safety algorithm (demand = Need) and deadlock detection (demand = Request).
// Each round scans from P0 and takes the first unfinished process whose demand fits in Work.
function safetyLoop(avail, alloc, demand, demandName, startFin, trace) {
  const n = alloc.length, work = [...avail], fin = startFin ? [...startFin] : alloc.map(() => false), seq = [];
  let comps = 0, progress = true;
  const snap = (text, cur, ok) => trace.push({ text, work: [...work], fin: [...fin], cur, ok });
  snap(`Work = Available = ${fmt(work)}` + (startFin ? ". Processes holding nothing are marked finished." : "."), null);
  while (progress) {
    progress = false;
    for (let i = 0; i < n; i++) {
      if (fin[i]) continue;
      comps++;
      if (leq(demand[i], work)) {
        const before = [...work];
        for (let j = 0; j < work.length; j++) work[j] += alloc[i][j];
        fin[i] = true; seq.push(i); progress = true;
        snap(`P${i}: ${demandName} ${fmt(demand[i])} ≤ Work ${fmt(before)} → P${i} can finish and returns ${fmt(alloc[i])}. Work = ${fmt(work)}`, i, true);
        break;
      }
      snap(`P${i}: ${demandName} ${fmt(demand[i])} is not ≤ Work ${fmt(work)} → cannot run yet`, i, false);
    }
  }
  return { fin, seq, comps, work };
}

// Banker's algorithm. rq = { i, r } for the resource-request algorithm, or null for a plain safety check.
function runBanker(s, rq) {
  let { avail, alloc, need } = s;
  const trace = [], base = { work: [...avail], fin: alloc.map(() => false) };
  const early = (status, cls, summary, text, decision) => {
    trace.push({ text, ...base, cur: rq.i, ok: false });
    return { algo: "banker", status, cls, summary, trace, comps: 0, decision, seq: [], view: matrixView(s, alloc, need, "Need") };
  };
  if (rq) {
    const { i, r } = rq;
    if (!leq(r, need[i]))
      return early("ERROR", "b-bad", `P${i} asked for more than its declared maximum.`, `Request ${fmt(r)} is not ≤ Need ${fmt(need[i])} → error: process exceeded its maximum claim.`, "error");
    if (!leq(r, avail))
      return early("WAIT", "b-info", `P${i} must wait: the resources are not free yet.`, `Request ${fmt(r)} is not ≤ Available ${fmt(avail)} → P${i} must wait.`, "wait");
    trace.push({ text: `Request ${fmt(r)} ≤ Need ${fmt(need[i])} and ≤ Available ${fmt(avail)}. Pretend to allocate it to P${i}.`, ...base, cur: i, ok: true });
    avail = sub(avail, r);
    alloc = alloc.map((row, k) => k === rq.i ? add(row, r) : row);
    need = need.map((row, k) => k === rq.i ? sub(row, r) : row);
    trace.push({ text: `Available = ${fmt(avail)}, Allocation[P${i}] = ${fmt(alloc[i])}, Need[P${i}] = ${fmt(need[i])}. Run the safety algorithm on this new state.`, work: [...avail], fin: base.fin, cur: i, ok: true });
  }
  const res = safetyLoop(avail, alloc, need, "Need", null, trace);
  const safe = res.fin.every(Boolean);
  const stuck = res.fin.map((f, i) => f ? null : "P" + i).filter(Boolean).join(", ");
  let summary = safe ? `Safe sequence: <${res.seq.map(p => "P" + p).join(", ")}>` : `No safe sequence exists. Stuck processes: ${stuck}.`;
  let status = safe ? "SAFE" : "UNSAFE", cls = safe ? "b-safe" : "b-bad", decision = null;
  if (rq) {
    decision = safe ? "granted" : "wait";
    status = safe ? "REQUEST GRANTED" : "REQUEST DENIED";
    summary += safe ? ` — P${rq.i}'s request ${fmt(rq.r)} is granted.` : ` — the state would be unsafe, so P${rq.i} must wait.`;
  }
  trace.push({ text: summary, work: [...res.work], fin: [...res.fin], cur: null, ok: safe });
  return { algo: "banker", status, cls, summary, trace, comps: res.comps, seq: res.seq, decision, rq, view: matrixView(s, alloc, need, "Need") };
}

// Deadlock detection for multiple instances: same loop, but with the Request matrix.
function runDetect(s) {
  const trace = [], startFin = s.alloc.map(r => r.every(v => v === 0));
  const res = safetyLoop(s.avail, s.alloc, s.req, "Request", startFin, trace);
  const dead = res.fin.map((f, i) => f ? null : i).filter(x => x !== null);
  const summary = dead.length ? `Deadlock! Deadlocked processes: ${dead.map(p => "P" + p).join(", ")}` : "No deadlock — every process can finish.";
  trace.push({ text: summary, work: [...res.work], fin: [...res.fin], cur: null, ok: !dead.length });
  return { algo: "detect", status: dead.length ? "DEADLOCK" : "NO DEADLOCK", cls: dead.length ? "b-bad" : "b-safe",
           summary, trace, comps: res.comps, seq: res.seq, view: matrixView(s, s.alloc, s.req, "Request") };
}

// Resource Allocation Graph: nodes 0..n-1 are processes, n..n+m-1 are resource types.
// R -> P means an instance is assigned, P -> R means a request. Cycle search with DFS (white/grey/black).
function runRAG(s) {
  const { n, m } = s, V = n + m, adj = Array.from({ length: V }, () => []), edges = [];
  const name = v => v < n ? "P" + v : letter(v - n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    if (s.alloc[i][j] > 0) { adj[n + j].push(i); edges.push({ a: n + j, b: i, kind: "assign", w: s.alloc[i][j] }); }
    if (s.req[i][j] > 0) { adj[i].push(n + j); edges.push({ a: i, b: n + j, kind: "request", w: s.req[i][j] }); }
  }
  const trace = [{ text: `Graph built: ${edges.length} edge(s). Assignment edges R → P (blue), request edges P → R (orange).`, path: [], cycle: null }];
  const color = Array(V).fill(0), path = []; let comps = 0, cycle = null;
  const dfs = v => {
    color[v] = 1; path.push(v);
    trace.push({ text: `Visit ${name(v)} (grey, on the current path).`, path: [...path], cycle: null });
    for (const w of adj[v]) {
      comps++;
      if (color[w] === 1) {
        cycle = path.slice(path.indexOf(w)).concat(w);
        trace.push({ text: `Edge ${name(v)} → ${name(w)} leads back to ${name(w)}, which is on the current path: CYCLE ${cycle.map(name).join(" → ")}.`, path: [...path], cycle });
        return true;
      }
      if (color[w] === 2) { trace.push({ text: `Edge ${name(v)} → ${name(w)}: ${name(w)} is already fully explored, skip.`, path: [...path], cycle: null }); continue; }
      trace.push({ text: `Follow edge ${name(v)} → ${name(w)}.`, path: [...path], cycle: null });
      if (dfs(w)) return true;
    }
    color[v] = 2; path.pop();
    trace.push({ text: `${name(v)} fully explored (black), back up.`, path: [...path], cycle: null });
    return false;
  };
  for (let v = 0; v < V && !cycle; v++) if (color[v] === 0) dfs(v);
  const single = s.total.every(t => t <= 1);
  let summary = cycle ? `Cycle found: ${cycle.map(name).join(" → ")}` : "No cycle found — no deadlock.";
  if (cycle) summary += single ? " — every resource has one instance, so this is a deadlock." : " — some resources have several instances, so this only shows a POSSIBLE deadlock. Use Deadlock detection to be sure.";
  trace.push({ text: summary, path: [], cycle });
  return { algo: "rag", status: cycle ? (single ? "DEADLOCK" : "CYCLE FOUND") : "NO DEADLOCK", cls: cycle ? (single ? "b-bad" : "b-info") : "b-safe",
           summary, trace, comps, cycle, view: { type: "graph", n, m, total: s.total, edges } };
}

function matrixView(s, alloc, demand, demandName) { return { type: "matrix", n: s.n, m: s.m, alloc, demand, demandName }; }
const ALGOS = { banker: runBanker, rag: runRAG, detect: runDetect };
const NAMES = { banker: "Banker's algorithm", rag: "Resource Allocation Graph", detect: "Deadlock detection" };

/* ===================== 4. rendering ===================== */
let current = null, step = 0, granted = 0, waiting = 0, timer = null;

function resetResults() {
  stopPlay(); current = null; step = 0;
  $("statusBar").className = "empty"; $("statusBar").innerHTML = "Choose an algorithm and press <b>Run simulation</b>, or step through it.";
  ["summary", "stateView", "stepLog", "compareOut"].forEach(id => $(id).innerHTML = "");
  $("perf").className = "empty"; $("perf").textContent = "Run an algorithm to see its performance figures.";
  updateButtons();
}

function execute(toEnd) {
  try {
    const s = readSystem(), algo = document.querySelector("input[name=algo]:checked").value;
    if ([].concat(...s.alloc, ...s.max, ...s.req).every(v => v === 0))
      throw fail("Allocation, Maximum and Request are all 0, so there is nothing to simulate. Type your values into the tables, or press one of the Load example buttons.");
    const rq = algo === "banker" ? readRequest(s) : null;
    showError(""); stopPlay();
    const res = algo === "banker" ? runBanker(s, rq) : ALGOS[algo](s);
    res.time = measure(() => algo === "banker" ? runBanker(s, rq) : ALGOS[algo](s));
    res.sys = s;
    if (res.decision === "granted") {                       // a granted request really changes the system
      const { i, r } = rq; granted++;
      r.forEach((v, j) => $(`alloc-${i}-${j}`).value = s.alloc[i][j] + v);
      $("reqVec").value = ""; refreshDerived();
    } else if (res.decision) waiting++;
    current = res; step = toEnd ? res.trace.length - 1 : 0;
    render();
  } catch (e) { showError(e.message); if (e.cell && $(e.cell)) $(e.cell).classList.add("bad"); }
}

function render() {
  if (!current) return;
  const res = current, last = res.trace.length - 1, t = res.trace[step], done = step === last;
  $("statusBar").className = "";
  $("statusBar").innerHTML = done
    ? `<span class="badge ${res.cls}">${res.status}</span><b>${NAMES[res.algo]}</b>`
    : `<span class="badge b-run">Step ${step + 1} / ${last + 1}</span><b>${NAMES[res.algo]}</b><span class="hint">in progress…</span>`;
  $("summary").textContent = done ? res.summary : "";
  $("stateView").innerHTML = res.view.type === "graph" ? graphSVG(res.view, t) : stateTable(res.view, t);
  $("stepLog").innerHTML = res.trace.slice(0, step + 1)
    .map((x, k) => `<li class="${k === step ? "cur " : ""}${x.ok === true ? "ok" : x.ok === false ? "no" : ""}">${x.text.replace(/</g, "&lt;")}</li>`).join("");
  const log = $("stepLog"); log.scrollTop = log.scrollHeight;
  renderPerf(res); updateButtons();
}

function stateTable(v, t) {
  let h = `<table class="state"><tr><th>Process</th><th>Allocation</th><th>${v.demandName}</th><th>Finished</th></tr>`;
  for (let i = 0; i < v.n; i++)
    h += `<tr class="${t.cur === i ? "cur " : ""}${t.fin[i] ? "done" : ""}"><td><b>P${i}</b></td><td>${fmt(v.alloc[i])}</td><td>${fmt(v.demand[i])}</td><td>${t.fin[i] ? "✔" : "—"}</td></tr>`;
  return h + `</table><div class="work">Work = <code>${fmt(t.work)}</code></div>`;
}

// Draw the Resource Allocation Graph as SVG. Highlights the current DFS path, and the cycle in red.
function graphSVG(v, t) {
  const W = 560, H = 300, V = v.n + v.m, pos = [];
  for (let i = 0; i < v.n; i++) pos[i] = { x: W * (i + 1) / (v.n + 1), y: 60 };
  for (let j = 0; j < v.m; j++) pos[v.n + j] = { x: W * (j + 1) / (v.m + 1), y: 235 };
  const name = k => k < v.n ? "P" + k : letter(k - v.n);
  const onPath = new Set(), onCycle = new Set();
  for (let k = 0; k + 1 < t.path.length; k++) onPath.add(t.path[k] + ">" + t.path[k + 1]);
  if (t.cycle) for (let k = 0; k + 1 < t.cycle.length; k++) onCycle.add(t.cycle[k] + ">" + t.cycle[k + 1]);
  const colorOf = e => onCycle.has(e.a + ">" + e.b) ? "#c0392b" : onPath.has(e.a + ">" + e.b) ? "#111" : e.kind === "assign" ? "#2f6fdb" : "#e08a00";
  const marker = c => "ah" + c.replace("#", "");
  const cols = [...new Set(v.edges.map(colorOf).concat(["#2f6fdb", "#e08a00"]))];
  let s = `<svg class="graph" viewBox="0 0 ${W} ${H}"><defs>` + cols.map(c =>
    `<marker id="${marker(c)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("") + `</defs>`;
  for (const e of v.edges) {
    const a = pos[e.a], b = pos[e.b], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, ra = e.a < v.n ? 20 : 22, rb = e.b < v.n ? 22 : 24;   // stop at the node border
    const x1 = a.x + ux * ra, y1 = a.y + uy * ra, x2 = b.x - ux * rb, y2 = b.y - uy * rb;
    const off = (e.kind === "assign" ? 1 : -1) * 22, cx = (x1 + x2) / 2 - uy * off, cy = (y1 + y2) / 2 + ux * off;
    const c = colorOf(e), thick = c === "#c0392b" || c === "#111" ? 3 : 1.8;
    s += `<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" fill="none" stroke="${c}" stroke-width="${thick}" marker-end="url(#${marker(c)})"/>`;
    if (e.w > 1) s += `<text x="${cx}" y="${cy}" font-size="11" fill="${c}" text-anchor="middle">×${e.w}</text>`;
  }
  for (let k = 0; k < V; k++) {
    const p = pos[k], hot = t.path.includes(k), cyc = t.cycle && t.cycle.includes(k);
    const stroke = cyc ? "#c0392b" : hot ? "#111" : "#6b7aa8", fill = cyc ? "#fde2de" : hot ? "#fff3cd" : "#fff";
    if (k < v.n) s += `<circle cx="${p.x}" cy="${p.y}" r="20" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-weight="700" font-size="14">${name(k)}</text>`;
    else {
      const tot = v.total[k - v.n], dots = Math.min(tot, 8);
      s += `<rect x="${p.x - 22}" y="${p.y - 22}" width="44" height="44" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${p.x}" y="${p.y - 4}" text-anchor="middle" font-weight="700" font-size="14">${name(k)}</text>`;
      for (let d = 0; d < dots; d++) s += `<circle cx="${p.x - (dots - 1) * 4 + d * 8}" cy="${p.y + 12}" r="2.5" fill="#333"/>`;
      if (tot > 8) s += `<text x="${p.x}" y="${p.y + 36}" text-anchor="middle" font-size="10">${tot} instances</text>`;
    }
  }
  return s + `</svg><div class="legend"><span style="color:#2f6fdb">━ assignment R→P</span> &nbsp; <span style="color:#e08a00">━ request P→R</span> &nbsp; <b>━ current path</b> &nbsp; <span style="color:#c0392b">━ cycle</span> &nbsp; (dots = instances)</div>`;
}

function updateButtons() {
  const last = current ? current.trace.length - 1 : 0;
  $("btnPrev").disabled = !current || step <= 0;
  $("btnNext").disabled = current && step >= last;
  $("btnPlay").disabled = !current || step >= last;
}
function nextStep() { if (!current) return execute(false); if (step < current.trace.length - 1) { step++; render(); } else stopPlay(); }
function prevStep() { if (current && step > 0) { step--; render(); } }
function stopPlay() { if (timer) { clearInterval(timer); timer = null; } $("btnPlay").textContent = "Auto-play"; }
function togglePlay() {
  if (timer) return stopPlay();
  $("btnPlay").textContent = "Pause";
  timer = setInterval(() => { nextStep(); if (current && step >= current.trace.length - 1) stopPlay(); }, 800);
}

/* ===================== 5. performance & benchmark ===================== */
function renderPerf(res) {
  const s = res.sys, util = s.total.map((t, j) => t ? Math.round(100 * s.used[j] / t) : 0);
  $("perf").className = "";
  $("perf").innerHTML = `<div class="cards">
    <div class="metric"><small>Execution time</small><strong>${res.time.toFixed(2)} µs</strong></div>
    <div class="metric"><small>Comparisons</small><strong>${res.comps}</strong></div>
    <div class="metric"><small>Requests granted / waiting</small><strong>${granted} / ${waiting}</strong></div>
    <div class="metric"><small>Resource utilisation</small>${util.map((u, j) =>
      `${letter(j)} <span class="bar" style="display:inline-block;width:90px"><i style="width:${u}%"></i></span> ${u}%<br>`).join("")}</div></div>`;
}

function compareTable(s, note) {
  const rows = Object.keys(ALGOS).map(a => {
    const run = () => a === "banker" ? runBanker(s, null) : ALGOS[a](s);
    const r = run(); return { name: NAMES[a], status: r.status, comps: r.comps, time: measure(run) };
  });
  const maxC = Math.max(...rows.map(r => r.comps), 1), maxT = Math.max(...rows.map(r => r.time), 1e-9);
  return `<table><tr><th>Algorithm</th><th>Result</th><th>Comparisons</th><th>Average time</th></tr>` + rows.map(r =>
    `<tr><td><b>${r.name}</b></td><td>${r.status}</td>
     <td>${r.comps}<div class="bar"><i style="width:${100 * r.comps / maxC}%"></i></div></td>
     <td>${r.time.toFixed(2)} µs<div class="bar"><i class="t" style="width:${100 * r.time / maxT}%"></i></div></td></tr>`).join("") + `</table><small>${note}</small>`;
}

function compareAll() {
  try { const s = readSystem(); showError(""); $("compareOut").innerHTML = compareTable(s, "Banker's algorithm uses the Need matrix, the two detection methods use the Request matrix. Banker's request field is ignored here."); }
  catch (e) { showError(e.message); if (e.cell && $(e.cell)) $(e.cell).classList.add("bad"); }
}

// Random system of N processes and 5 resource types, only for the benchmark (not shown in the tables).
function randomSystem(N, m = 5) {
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const alloc = Array.from({ length: N }, () => Array.from({ length: m }, () => rnd(0, 3)));
  const max = alloc.map(r => r.map(v => v + rnd(0, 4)));
  const req = alloc.map(() => Array.from({ length: m }, () => Math.random() < 0.6 ? 0 : rnd(0, 3)));
  const used = zeros(m); alloc.forEach(r => r.forEach((v, j) => used[j] += v));
  const total = used.map(u => u + rnd(3, 8));
  return { n: N, m, total, alloc, max, req, need: max.map((r, i) => sub(r, alloc[i])), avail: sub(total, used), used };
}
function benchmark() {
  const N = Number($("benchN").value);
  $("compareOut").innerHTML = compareTable(randomSystem(N), `Random system with ${N} processes and 5 resource types (a new one each click, so results vary). Comparisons grow with n, which is why avoidance on every request is expensive for large systems.`);
}

/* ===================== 6. events ===================== */
$("btnBuild").onclick = () => { buildTables(); resetResults(); };
$("btnS1").onclick = () => loadExample(EX_BANKER);
$("btnS2").onclick = () => { loadExample(EX_DETECT); document.querySelector("input[value=detect]").checked = true; };
$("btnS3").onclick = () => { loadExample(EX_GRAPH); document.querySelector("input[value=rag]").checked = true; };
$("btnRun").onclick = () => execute(true);
$("btnNext").onclick = nextStep;
$("btnPrev").onclick = prevStep;
$("btnPlay").onclick = togglePlay;
$("btnReset").onclick = () => { granted = 0; waiting = 0; $("reqVec").value = ""; buildTables(); resetResults(); };
$("btnCompare").onclick = compareAll;
$("btnBench").onclick = benchmark;
$("matrices").addEventListener("input", () => { refreshDerived(); if (current) resetResults(); });
// Option 2: when Total Resources changes, regenerate Allocation, Maximum and
// Request with values that fit the new totals, then refresh Need/Available and
// rerun the selected algorithm. This intentionally replaces the current sample data.
function regenerateTablesForTotals() {
  if (!dims.n || !dims.m) return false;
  const { n, m } = dims, total = [];
  for (let j = 0; j < m; j++) {
    const raw = $("tot-" + j).value.trim();
    if (raw === "" || !Number.isInteger(Number(raw)) || Number(raw) < 0) return false;
    total.push(Number(raw));
  }
  const alloc = Array.from({ length: n }, () => zeros(m));
  const max = Array.from({ length: n }, () => zeros(m));
  const req = Array.from({ length: n }, () => zeros(m));
  for (let j = 0; j < m; j++) {
    // Use only part of each resource pool, leaving at least one instance
    // available whenever total > 0.
    const allocBudget = total[j] > 0 ? Math.floor(Math.random() * total[j]) : 0;
    let remaining = allocBudget;
    for (let i = 0; i < n; i++) {
      const cap = Math.min(remaining, Math.max(0, Math.ceil(allocBudget / Math.max(1, n))));
      const value = cap > 0 ? Math.floor(Math.random() * (cap + 1)) : 0;
      alloc[i][j] = value;
      remaining -= value;
    }
    for (let i = 0; i < n && remaining > 0; i++) {
      const extra = Math.floor(Math.random() * (remaining + 1));
      alloc[i][j] += extra;
      remaining -= extra;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    max[i][j] = alloc[i][j] + Math.floor(Math.random() * (Math.max(1, total[j] + 1)));
    req[i][j] = total[j] > 0 ? Math.floor(Math.random() * (Math.min(total[j], 3) + 1)) : 0;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    $(`alloc-${i}-${j}`).value = alloc[i][j];
    $(`max-${i}-${j}`).value = max[i][j];
    $(`req-${i}-${j}`).value = req[i][j];
  }
  refreshDerived();
  return true;
}
$("totals").addEventListener("input", () => {
  if (!regenerateTablesForTotals()) return;
  // Changing totals updates the generated inputs and calculated Available/Need,
  // but execution output appears only after the user presses Run simulation.
  resetResults();
});
// Clicking a cell selects its content, so typing replaces the 0 instead of adding to it.
["matrices", "totals"].forEach(id => $(id).addEventListener("focusin", e => { if (e.target.tagName === "INPUT") e.target.select(); }));
document.querySelectorAll("input[name=algo]").forEach(r => r.onchange = resetResults);
buildTables(EX_BANKER);
resetResults();
