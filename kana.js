"use strict";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("kana." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kana." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const toKata = (s) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------- inventory
// [row key, label, group, hiragana cells ("-" = empty), romaji]
const ROWS = [
  ["a", "あ", "basic", "あ い う え お", "a i u e o"],
  ["k", "か", "basic", "か き く け こ", "ka ki ku ke ko"],
  ["s", "さ", "basic", "さ し す せ そ", "sa shi su se so"],
  ["t", "た", "basic", "た ち つ て と", "ta chi tsu te to"],
  ["n", "な", "basic", "な に ぬ ね の", "na ni nu ne no"],
  ["h", "は", "basic", "は ひ ふ へ ほ", "ha hi fu he ho"],
  ["m", "ま", "basic", "ま み む め も", "ma mi mu me mo"],
  ["y", "や", "basic", "や - ゆ - よ", "ya - yu - yo"],
  ["r", "ら", "basic", "ら り る れ ろ", "ra ri ru re ro"],
  ["w", "わ", "basic", "わ - - - を", "wa - - - wo"],
  ["nn", "ん", "basic", "ん - - - -", "n - - - -"],
  ["g", "が", "dakuten", "が ぎ ぐ げ ご", "ga gi gu ge go"],
  ["z", "ざ", "dakuten", "ざ じ ず ぜ ぞ", "za ji zu ze zo"],
  ["d", "だ", "dakuten", "だ ぢ づ で ど", "da ji zu de do"],
  ["b", "ば", "dakuten", "ば び ぶ べ ぼ", "ba bi bu be bo"],
  ["p", "ぱ", "dakuten", "ぱ ぴ ぷ ぺ ぽ", "pa pi pu pe po"],
  ["ky", "きゃ", "combo", "きゃ きゅ きょ", "kya kyu kyo"],
  ["sh", "しゃ", "combo", "しゃ しゅ しょ", "sha shu sho"],
  ["ch", "ちゃ", "combo", "ちゃ ちゅ ちょ", "cha chu cho"],
  ["ny", "にゃ", "combo", "にゃ にゅ にょ", "nya nyu nyo"],
  ["hy", "ひゃ", "combo", "ひゃ ひゅ ひょ", "hya hyu hyo"],
  ["my", "みゃ", "combo", "みゃ みゅ みょ", "mya myu myo"],
  ["ry", "りゃ", "combo", "りゃ りゅ りょ", "rya ryu ryo"],
  ["gy", "ぎゃ", "combo", "ぎゃ ぎゅ ぎょ", "gya gyu gyo"],
  ["j", "じゃ", "combo", "じゃ じゅ じょ", "ja ju jo"],
  ["by", "びゃ", "combo", "びゃ びゅ びょ", "bya byu byo"],
  ["py", "ぴゃ", "combo", "ぴゃ ぴゅ ぴょ", "pya pyu pyo"],
];
const GROUPS = [["basic", "Basic"], ["dakuten", "゛゜ Dakuten"], ["combo", "ゃ Combinations"]];
// Accepted alternative spellings when typing.
const ALTS = {
  shi: ["si"], chi: ["ti"], tsu: ["tu"], fu: ["hu"], ji: ["zi", "di", "dji"], zu: ["du", "dzu"], wo: ["o"], n: ["nn", "n'"],
  sha: ["sya"], shu: ["syu"], sho: ["syo"], cha: ["tya", "cya"], chu: ["tyu", "cyu"], cho: ["tyo", "cyo"],
  ja: ["zya", "jya"], ju: ["zyu", "jyu"], jo: ["zyo", "jyo"],
};
// Visually confusable groups (used for distractors and the Look-alikes set).
const LOOK = {
  h: ["さち", "ぬめ", "るろ", "われね", "はほけ", "いり", "こに", "あおめ", "きさ", "まも", "うつ", "しも", "たな"],
  k: ["シツ", "ソン", "ノメ", "クタケ", "ウワフ", "コユロ", "チテ", "ヌス", "ルレ", "マム", "ラヲ", "セヤ", "ナメ", "エユ", "ハへ"],
};

const ITEMS = [];
const BY_ID = {};
for (const [row, , group, cells, roms] of ROWS) {
  const ch = cells.split(" ");
  const ro = roms.split(" ");
  ch.forEach((h, col) => {
    if (h === "-") return;
    for (const s of ["h", "k"]) {
      const c = s === "h" ? h : toKata(h);
      const it = { id: s + ":" + h, s, h, ch: c, rom: ro[col], row, group, col };
      it.look = new Set(LOOK[s].filter((g) => g.includes(c)).join("").split("").filter((x) => x !== c));
      ITEMS.push(it);
      BY_ID[it.id] = it;
    }
  });
}
const counterpart = (it) => BY_ID[(it.s === "h" ? "k:" : "h:") + it.h];

// ---------------------------------------------------------------- state
const state = {
  tab: store.get("tab", "chart"),
  script: store.get("script", "h"),
  rows: new Set(store.get("rows", ["a", "k", "s"])),
  special: store.get("special", ""),
  quizMode: store.get("quizMode", "read"),
  matchMode: store.get("matchMode", "rom"),
  chartRomaji: store.get("chartRomaji", true),
};
const stats = store.get("stats", {});
let qn = store.get("qn", 0);
const saveStats = () => { store.set("stats", stats); store.set("qn", qn); };
const boxOf = (it) => (stats[it.id] ? stats[it.id].box : -1);

function scriptsOn() { return state.script === "b" ? ["h", "k"] : [state.script]; }

function currentPool() {
  const scripts = scriptsOn();
  let pool = ITEMS.filter((it) => scripts.includes(it.s));
  if (state.special === "look") pool = pool.filter((it) => it.look.size);
  else if (state.special === "weak") pool = pool.filter((it) => stats[it.id] && stats[it.id].box <= 1);
  else pool = pool.filter((it) => state.rows.has(it.row));
  return pool;
}

function saveSet() {
  store.set("rows", [...state.rows]);
  store.set("special", state.special);
  renderSetup();
  renderChart();
  if (state.tab === "quiz") nextQuestion();
  if (state.tab === "match") newMatch();
}

// ---------------------------------------------------------------- audio (device TTS)
let jaVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const ja = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
  const rank = (v) => (/natural|online|neural/i.test(v.name) ? 3 : 0) + (/nanami|google|kyoko|o-ren/i.test(v.name) ? 2 : 0);
  jaVoice = ja.sort((a, b) => rank(b) - rank(a))[0] || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.addEventListener?.("voiceschanged", pickVoice); }

function speak(text) {
  if (!window.speechSynthesis) { toast("Speech synthesis is not available in this browser."); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.85;
  if (jaVoice) u.voice = jaVoice;
  else if (!speak.warned) { speak.warned = true; toast("No Japanese voice found; install one in your device's speech settings."); }
  speechSynthesis.speak(u);
}
const say = (it) => speak(it.h);

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}

// ---------------------------------------------------------------- setup bar
function renderSetup() {
  for (const b of $("script").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === state.script);
  $("rows").innerHTML = ROWS.map(([key, label, group]) => {
    const on = !state.special && state.rows.has(key);
    const lbl = state.script === "k" ? toKata(label) : label;
    return `<button class="chip row-chip g-${group}${on ? " on" : ""}" data-row="${key}">${lbl}</button>`;
  }).join("");
  $("selLook").classList.toggle("on", state.special === "look");
  $("selWeak").classList.toggle("on", state.special === "weak");
  const pool = currentPool();
  const mastered = pool.filter((it) => boxOf(it) >= 3).length;
  $("setInfo").textContent = `${pool.length} kana selected · ${mastered} mastered`;
}

$("script").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (!b) return;
  state.script = b.dataset.v;
  store.set("script", state.script);
  saveSet();
});
$("rows").addEventListener("click", (e) => {
  const b = e.target.closest("[data-row]");
  if (!b) return;
  toggleRow(b.dataset.row);
});
function toggleRow(key) {
  if (state.special) { state.special = ""; state.rows = new Set(); }
  if (state.rows.has(key)) state.rows.delete(key); else state.rows.add(key);
  saveSet();
}
$("selBasic").onclick = () => { state.special = ""; state.rows = new Set(ROWS.filter((r) => r[2] === "basic").map((r) => r[0])); saveSet(); };
$("selAll").onclick = () => { state.special = ""; state.rows = new Set(ROWS.map((r) => r[0])); saveSet(); };
$("selLook").onclick = () => { state.special = state.special === "look" ? "" : "look"; saveSet(); };
$("selWeak").onclick = () => {
  const any = ITEMS.some((it) => scriptsOn().includes(it.s) && stats[it.id] && stats[it.id].box <= 1);
  if (!any && state.special !== "weak") { toast("No weak kana yet — take a quiz first."); return; }
  state.special = state.special === "weak" ? "" : "weak";
  saveSet();
};

// ---------------------------------------------------------------- tabs
function showTab(tab) {
  state.tab = tab;
  store.set("tab", tab);
  for (const b of document.querySelectorAll(".tabs [data-tab]")) b.classList.toggle("on", b.dataset.tab === tab);
  for (const s of document.querySelectorAll(".tab")) s.hidden = s.id !== "tab-" + tab;
  hideDetail();
  if (tab === "quiz") nextQuestion();
  if (tab === "match") newMatch();
  if (tab === "chart") renderChart();
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) showTab(b.dataset.tab);
});

// ---------------------------------------------------------------- chart
const mClass = (box) => (box < 0 ? "m0" : box <= 1 ? "m1" : box <= 3 ? "m3" : "m5");

function renderChart() {
  const scripts = scriptsOn();
  const main = scripts[0];
  let html = "";
  for (const [group, title] of GROUPS) {
    const cols = group === "combo" ? 3 : 5;
    html += `<h3>${title}</h3><div class="kgrid c${cols}">`;
    for (const [key, label, g, cells] of ROWS) {
      if (g !== group) continue;
      const sel = !state.special && state.rows.has(key);
      html += `<button class="row-head${sel ? " on" : ""}" data-row="${key}" title="Add/remove row">${main === "k" ? toKata(label) : label}</button>`;
      for (const h of cells.split(" ")) {
        if (h === "-") { html += `<span class="kcell empty"></span>`; continue; }
        const its = scripts.map((s) => BY_ID[s + ":" + h]);
        const box = Math.min(...its.map(boxOf));
        const sub = its[1] ? `<span class="k-sub">${its[1].ch}</span>` : "";
        const rom = state.chartRomaji ? `<span class="k-rom">${its[0].rom}</span>` : "";
        html += `<button class="kcell ${mClass(box)}" data-id="${its[0].id}"><span class="k-ch">${its[0].ch}</span>${sub}${rom}</button>`;
      }
    }
    html += `</div>`;
  }
  $("chart").innerHTML = html;
}

$("chart").addEventListener("click", (e) => {
  const head = e.target.closest("[data-row]");
  if (head) { toggleRow(head.dataset.row); return; }
  const cell = e.target.closest("[data-id]");
  if (cell) { const it = BY_ID[cell.dataset.id]; say(it); showDetail(it); }
});
$("chartRomaji").onchange = (e) => { state.chartRomaji = e.target.checked; store.set("chartRomaji", state.chartRomaji); renderChart(); };

// ---------------------------------------------------------------- detail (stroke order + tracing)
let detailItem = null;
let strokeTimer = null;

function showDetail(it) {
  detailItem = it;
  const other = counterpart(it);
  $("kdChar").textContent = it.ch;
  $("kdRom").textContent = it.rom;
  $("kdOther").innerHTML = `<button class="kd-swap" title="Show ${it.s === "h" ? "katakana" : "hiragana"}">${other.ch}</button>`;
  const st = stats[it.id];
  const strokes = [...it.ch].reduce((n, c) => n + (window.KANA_STROKES?.[c]?.length || 0), 0);
  $("kdMeta").textContent = `${it.s === "h" ? "Hiragana" : "Katakana"} · ${strokes} stroke${strokes === 1 ? "" : "s"}` +
    (st ? ` · ${st.ok}/${st.seen} correct` : " · not practised yet");
  $("detail").hidden = false;
  document.body.classList.add("has-def");
  setTrace(false);
  drawStrokes(it, true);
}

function hideDetail() {
  $("detail").hidden = true;
  document.body.classList.remove("has-def");
  clearTimeout(strokeTimer);
}

function drawStrokes(it, animate) {
  clearTimeout(strokeTimer);
  const chars = [...it.ch];
  const svg = $("kdSvg");
  svg.setAttribute("viewBox", `0 0 ${109 * chars.length} 109`);
  svg.style.width = `${7.5 * chars.length}rem`;
  let html = "";
  chars.forEach((c, i) => {
    const paths = window.KANA_STROKES?.[c] || [];
    html += `<g transform="translate(${109 * i},0)">` +
      paths.map((d) => `<path class="ghost" d="${d}"/>`).join("") +
      paths.map((d) => `<path class="stroke" d="${d}"/>`).join("") + `</g>`;
  });
  svg.innerHTML = html;
  const strokes = [...svg.querySelectorAll(".stroke")];
  for (const p of strokes) {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = animate ? `${len}` : "0";
  }
  if (!animate) return;
  let i = 0;
  const step = () => {
    if (i >= strokes.length) return;
    const p = strokes[i++];
    p.style.transition = "stroke-dashoffset .55s ease-in-out";
    p.style.strokeDashoffset = "0";
    strokeTimer = setTimeout(step, 650);
  };
  strokeTimer = setTimeout(step, 250);
}

// Tracing: draw over the faint glyph with a finger or mouse.
let tracing = false;
function setTrace(on) {
  tracing = on;
  const cv = $("kdCanvas");
  cv.hidden = !on;
  $("kdTrace").classList.toggle("on", on);
  $("detail").classList.toggle("tracing", on);
  if (on && detailItem) {
    const svg = $("kdSvg");
    const r = svg.getBoundingClientRect();
    cv.width = r.width * devicePixelRatio;
    cv.height = r.height * devicePixelRatio;
    cv.style.width = r.width + "px";
    cv.style.height = r.height + "px";
    drawStrokes(detailItem, false);
  }
}
(function initCanvas() {
  const cv = $("kdCanvas");
  const ctx = cv.getContext("2d");
  let drawing = false;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio]; };
  cv.addEventListener("pointerdown", (e) => {
    drawing = true;
    cv.setPointerCapture(e.pointerId);
    ctx.lineWidth = 7 * devicePixelRatio;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--accent");
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  });
  cv.addEventListener("pointermove", (e) => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); } });
  cv.addEventListener("pointerup", () => { drawing = false; });
})();

$("kdPlay").onclick = () => detailItem && say(detailItem);
$("kdReplay").onclick = () => { if (detailItem) { setTrace(false); drawStrokes(detailItem, true); } };
$("kdTrace").onclick = () => setTrace(!tracing);
$("kdClose").onclick = hideDetail;
$("kdOther").addEventListener("click", () => { if (detailItem) { const o = counterpart(detailItem); say(o); showDetail(o); } });

// ---------------------------------------------------------------- quiz
const INTERVAL = [1, 2, 4, 8, 16, 32]; // questions until an item is due again, by Leitner box
const session = { total: 0, ok: 0, streak: 0 };
let current = null;
let lastId = "";
let answered = false;
let advanceTimer = null;

function pickItem(pool) {
  const cand = pool.filter((it) => it.id !== lastId);
  const list = cand.length ? cand : pool;
  const due = list.filter((it) => !stats[it.id] || stats[it.id].due <= qn);
  if (due.length) {
    // Unseen and weak items first, with some randomness.
    const w = due.map((it) => 6 - Math.max(0, boxOf(it)) + (boxOf(it) < 0 ? 2 : 0));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < due.length; i++) { r -= w[i]; if (r <= 0) return due[i]; }
    return due[due.length - 1];
  }
  return list.reduce((a, b) => (stats[a.id].due <= stats[b.id].due ? a : b));
}

function distractors(target, n, from) {
  const pool = new Set(currentPool().map((it) => it.id));
  return shuffle(from.filter((it) => it.id !== target.id && it.rom !== target.rom))
    .map((it) => {
      let score = Math.random() * 1.5;
      if (target.look.has(it.ch)) score += 3;
      if (it.row === target.row) score += 1.5;
      if (it.col === target.col && it.group === target.group) score += 1;
      if (pool.has(it.id)) score += 1;
      if (it.group !== target.group) score -= 2;
      return [score, it];
    })
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map((x) => x[1]);
}

function nextQuestion() {
  clearTimeout(advanceTimer);
  answered = false;
  $("feedback").textContent = "";
  $("feedback").className = "feedback";
  $("nextBtn").hidden = true;
  const pool = currentPool();
  renderQuizStats(pool);
  if (pool.length < 2) {
    $("prompt").innerHTML = `<p class="empty">Pick at least two kana in the practice set above.</p>`;
    $("choices").innerHTML = "";
    $("typeForm").hidden = true;
    return;
  }
  current = pickItem(pool);
  lastId = current.id;
  const mode = state.quizMode;
  $("typeForm").hidden = mode !== "type";
  $("choices").hidden = mode === "type";
  if (mode === "listen") {
    $("prompt").innerHTML = `<button class="listen-btn" id="replay" aria-label="Play sound">▶</button><div class="prompt-sub">Which kana is this?</div>`;
    $("replay").onclick = () => say(current);
    say(current);
  } else {
    const sub = { read: "How is this read?", type: "Type the reading", pair: `Pick the ${current.s === "h" ? "katakana" : "hiragana"}` }[mode];
    $("prompt").innerHTML = `<div class="prompt-ch">${current.ch}</div><div class="prompt-sub">${sub}</div>`;
  }
  if (mode === "type") {
    $("typeInput").value = "";
    $("typeInput").disabled = false;
    $("typeInput").focus({ preventScroll: true });
    return;
  }
  let options;
  if (mode === "pair") {
    const target = counterpart(current);
    options = shuffle([target, ...distractors(target, 3, ITEMS.filter((it) => it.s === target.s))]);
  } else {
    options = shuffle([current, ...distractors(current, 3, ITEMS.filter((it) => it.s === current.s))]);
  }
  $("choices").innerHTML = options.map((it, i) => {
    const label = mode === "read" ? it.rom : it.ch;
    return `<button class="choice${mode === "read" ? " rom" : ""}" data-id="${it.id}"><span class="key">${i + 1}</span>${label}</button>`;
  }).join("");
}

function answer(correct, chosenEl) {
  if (answered) return;
  answered = true;
  record(current, correct);
  const right = state.quizMode === "pair" ? counterpart(current) : current;
  for (const b of $("choices").querySelectorAll(".choice")) {
    if (b.dataset.id === right.id) b.classList.add("right");
    else if (b === chosenEl) b.classList.add("wrong");
    b.disabled = true;
  }
  const fb = $("feedback");
  fb.className = "feedback " + (correct ? "ok" : "bad");
  fb.innerHTML = correct
    ? `Correct — ${current.ch} = <b>${current.rom}</b>`
    : `${current.ch} is <b>${current.rom}</b>` + (state.quizMode === "pair" ? ` (${counterpart(current).ch})` : "") +
      (current.look.size ? ` · don't mix it up with ${[...current.look].join(" ")}` : "");
  if (state.quizMode !== "listen") say(current);
  if (correct) advanceTimer = setTimeout(nextQuestion, 900);
  else { $("nextBtn").hidden = false; $("nextBtn").focus({ preventScroll: true }); }
  renderQuizStats(currentPool());
}

function record(it, correct) {
  const st = stats[it.id] || (stats[it.id] = { box: 0, due: 0, seen: 0, ok: 0 });
  qn++;
  st.seen++;
  session.total++;
  if (correct) {
    st.ok++;
    st.box = Math.min(5, st.box + 1);
    st.due = qn + INTERVAL[st.box];
    session.ok++;
    session.streak++;
  } else {
    st.box = Math.max(0, st.box - 2);
    st.due = qn + 2;
    session.streak = 0;
  }
  saveStats();
}

function renderQuizStats(pool) {
  const mastered = pool.filter((it) => boxOf(it) >= 3).length;
  $("qScore").textContent = `${session.ok} / ${session.total} correct`;
  $("qStreak").textContent = session.streak >= 3 ? `streak ${session.streak}` : "";
  $("qMastery").textContent = `${mastered} / ${pool.length} mastered`;
  $("qProgress").style.width = pool.length ? `${(100 * mastered) / pool.length}%` : "0";
}

$("choices").addEventListener("click", (e) => {
  const b = e.target.closest(".choice");
  if (!b || answered) return;
  const right = state.quizMode === "pair" ? counterpart(current) : current;
  answer(b.dataset.id === right.id, b);
});
$("typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (answered) { nextQuestion(); return; }
  const v = $("typeInput").value.trim().toLowerCase();
  if (!v) return;
  const ok = v === current.rom || (ALTS[current.rom] || []).includes(v);
  $("typeInput").disabled = true;
  answer(ok, null);
});
$("nextBtn").onclick = nextQuestion;
$("quizMode").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (!b) return;
  state.quizMode = b.dataset.v;
  store.set("quizMode", state.quizMode);
  for (const x of $("quizMode").querySelectorAll("button")) x.classList.toggle("on", x === b);
  nextQuestion();
});
document.addEventListener("keydown", (e) => {
  if (state.tab !== "quiz" || e.altKey || e.ctrlKey || e.metaKey) return;
  const inInput = e.target.matches("input, select, textarea");
  if (e.key === "Enter" && answered && !inInput) { e.preventDefault(); nextQuestion(); return; }
  if (inInput) return;
  if (e.key === " ") { e.preventDefault(); if (current) say(current); return; }
  const n = parseInt(e.key, 10);
  const btn = n >= 1 && n <= 4 && $("choices").querySelectorAll(".choice")[n - 1];
  if (btn && !answered) btn.click();
});

// ---------------------------------------------------------------- match game
const match = { first: null, left: 0, misses: 0, start: 0, timer: null };

function newMatch() {
  clearInterval(match.timer);
  for (const b of $("matchMode").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === state.matchMode);
  const pool = currentPool();
  const seen = new Set();
  const picked = [];
  // Prefer weaker kana, one per reading so pairs are unambiguous.
  for (const it of shuffle([...pool]).sort((a, b) => boxOf(a) - boxOf(b) + (Math.random() - 0.5) * 3)) {
    const key = state.matchMode === "rom" ? it.rom : it.h;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(it);
    if (picked.length === 6) break;
  }
  if (picked.length < 3) {
    $("matchGrid").innerHTML = `<p class="empty">Pick at least three kana in the practice set above.</p>`;
    $("matchInfo").textContent = "";
    return;
  }
  const cards = [];
  picked.forEach((it, i) => {
    cards.push({ pair: i, label: it.ch, it, jp: true });
    if (state.matchMode === "rom") cards.push({ pair: i, label: it.rom, it, jp: false });
    else { const o = counterpart(it); cards.push({ pair: i, label: o.ch, it: o, jp: true }); }
  });
  shuffle(cards);
  match.cards = cards;
  match.first = null;
  match.left = picked.length;
  match.misses = 0;
  match.start = 0;
  $("matchGrid").innerHTML = cards.map((c, i) =>
    `<button class="mcard${c.jp ? "" : " rom"}" data-i="${i}">${c.label}</button>`).join("");
  updateMatchInfo();
}

function updateMatchInfo(done) {
  const t = match.start ? (Date.now() - match.start) / 1000 : 0;
  const best = store.get("best." + state.matchMode, null);
  $("matchInfo").textContent = done
    ? `Done in ${t.toFixed(1)} s · ${match.misses} miss${match.misses === 1 ? "" : "es"}${best ? ` · best ${best.toFixed(1)} s` : ""}`
    : `${t.toFixed(1)} s · ${match.misses} miss${match.misses === 1 ? "" : "es"}`;
}

$("matchGrid").addEventListener("click", (e) => {
  const el = e.target.closest(".mcard");
  if (!el || el.classList.contains("done")) return;
  if (!match.start) { match.start = Date.now(); match.timer = setInterval(() => updateMatchInfo(), 200); }
  const card = match.cards[+el.dataset.i];
  if (card.jp) say(card.it);
  if (!match.first) { match.first = el; el.classList.add("sel"); return; }
  if (match.first === el) { el.classList.remove("sel"); match.first = null; return; }
  const a = match.cards[+match.first.dataset.i];
  const prev = match.first;
  match.first = null;
  prev.classList.remove("sel");
  if (a.pair === card.pair) {
    prev.classList.add("done");
    el.classList.add("done");
    if (--match.left === 0) {
      clearInterval(match.timer);
      const t = (Date.now() - match.start) / 1000;
      const key = "best." + state.matchMode;
      const best = store.get(key, null);
      if (!best || t < best) store.set(key, t);
      updateMatchInfo(true);
      if (!best || t < best) toast(`New best: ${t.toFixed(1)} s`);
    }
  } else {
    match.misses++;
    for (const x of [prev, el]) { x.classList.add("miss"); setTimeout(() => x.classList.remove("miss"), 450); }
    updateMatchInfo();
  }
});
$("matchNew").onclick = newMatch;
$("matchMode").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (!b) return;
  state.matchMode = b.dataset.v;
  store.set("matchMode", state.matchMode);
  newMatch();
});

// ---------------------------------------------------------------- init
for (const b of $("quizMode").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === state.quizMode);
$("chartRomaji").checked = state.chartRomaji;
renderSetup();
showTab(["chart", "quiz", "match"].includes(location.hash.slice(1)) ? location.hash.slice(1) : state.tab);
