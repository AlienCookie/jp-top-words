"use strict";

// Data files call JPW.index(...) / JPW.chunk(series, i, rows, lexicon); loaded via <script> so file:// works too.
// Series: "all" (rank order), "t-<topic>", "n<jlpt level>"; each is the same rows filtered, split into chunks.
// Row: [rank, kanji, kana, romaji, gloss, [sentence, ...], usuallyKana, jlptLevel(0-5), posCode, lexiconIndex]
// Sentence: [tatoebaId|0, english, nativeAudioAuthor|0, [[surface, kana, romaji, lexiconIndex|-1], ...], source]
//   source: "w" Wiktionary, "j" JMdict (curated Tatoeba), "t" Tatoeba
// Lexicon entry: [kanji, kana, romaji, [[gloss, ...] per sense], rank|0, partOfSpeech]
const chunks = {};
const pending = {};
let index = null;
let indexResolve;
const indexReady = new Promise((r) => (indexResolve = r));
window.JPW = {
  index(ix) { index = ix; indexResolve(ix); },
  chunk(series, i, rows, lex) {
    const key = `${series}/${i}`;
    chunks[key] = rows.map((row) => ({ row, lex }));
    if (pending[key]) pending[key].resolve(chunks[key]);
  },
};

function loadScript(src, onerror) {
  const s = document.createElement("script");
  s.src = src;
  s.onerror = onerror;
  document.head.appendChild(s);
}

function loadChunk(series, i) {
  const key = `${series}/${i}`;
  if (chunks[key]) return Promise.resolve(chunks[key]);
  if (!pending[key]) {
    pending[key] = {};
    pending[key].promise = new Promise((resolve, reject) => {
      pending[key].resolve = resolve;
      loadScript(`data/${series}/${String(i).padStart(3, "0")}.js`, () => {
        delete pending[key];
        reject(new Error(`${key} failed to load`));
      });
    });
  }
  return pending[key].promise;
}

// ---------------------------------------------------------------- settings / state
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("jpw." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("jpw." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const settings = {
  size: store.get("size", 50),
  script: store.get("script", "kata"),
  kanji: store.get("kanji", true),
  wordAudio: store.get("wordAudio", "rec"),
  rate: store.get("rate", 1),
  order: store.get("order", "kana"),
  romaji: store.get("romaji", "show"),
};
const filters = { topic: "", jlpt: 0, pos: "" };
let page = 1;
let pageRows = [];
let filtered = [];
const sentIdx = new Map(); // rank -> index of the example currently shown

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toKata = (s) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const kana = (s) => (settings.script === "kata" ? toKata(s) : s);

function applyDisplay() {
  const b = document.body.classList;
  b.toggle("hide-kanji", !settings.kanji);
  b.toggle("rom-top", settings.order === "rom");
  b.toggle("rom-off", settings.romaji === "off");
  b.toggle("rom-reveal", settings.romaji === "reveal");
}
const reveal = (el) => el && el.classList.add("revealed");

// ---------------------------------------------------------------- filtering
const topicRanks = {};
const seriesPos = {};

function seriesRankList(series) {
  if (series.startsWith("t-")) return topicRanks[series.slice(2)];
  const lvl = series.slice(1);
  const out = [];
  for (let i = 0; i < index.count; i++) if (index.jlpt[i] === lvl) out.push(i + 1);
  return out;
}

// Which series file holds a rank for the current filters, and at what position.
function locate(rank) {
  const series = filters.topic ? "t-" + filters.topic : filters.jlpt ? "n" + filters.jlpt : "all";
  if (series === "all") return [series, rank - 1];
  if (!seriesPos[series]) seriesPos[series] = new Map(seriesRankList(series).map((r, i) => [r, i]));
  return [series, seriesPos[series].get(rank)];
}

function matches(rank, f = filters) {
  if (f.jlpt && index.jlpt[rank - 1] !== String(f.jlpt)) return false;
  if (f.pos && index.pos[rank - 1] !== f.pos) return false;
  return true;
}

function computeFiltered() {
  const base = filters.topic ? topicRanks[filters.topic] : Array.from({ length: index.count }, (_, i) => i + 1);
  filtered = base.filter((r) => matches(r));
}

function renderFilterBar() {
  const counts = {};
  for (const t of index.topics) counts[t.id] = t.ranks.reduce((n, r) => n + matches(r), 0);
  let all = 0;
  for (let r = 1; r <= index.count; r++) all += matches(r);
  const chip = (id, label, n) =>
    `<button class="chip${filters.topic === id ? " on" : ""}" data-topic="${id}"${n ? "" : " disabled"}>${esc(label)} <span>${n.toLocaleString()}</span></button>`;
  $("topics").innerHTML = chip("", "All", all) + index.topics.map((t) => chip(t.id, t.label, counts[t.id])).join("");
  $("jlpt").value = String(filters.jlpt);
  $("pos").value = filters.pos;
  $("clearFilters").hidden = !(filters.topic || filters.jlpt || filters.pos);
}

// ---------------------------------------------------------------- audio
const player = new Audio();
player.preload = "auto";
let playToken = 0;
let activeEl = null;
const JPOD_PLACEHOLDER_SEC = 5.65; // JapanesePod101 "audio not available" clip
const missingWordAudio = new Set(store.get("missingAudio", []));

function setActive(el) {
  if (activeEl) activeEl.classList.remove("playing");
  activeEl = el;
  if (el) el.classList.add("playing");
}

function stopAll() {
  playToken++;
  player.pause();
  if (window.speechSynthesis) speechSynthesis.cancel();
  setActive(null);
}

let jaVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const ja = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
  const rank = (v) => (/natural|online|neural/i.test(v.name) ? 3 : 0) + (/nanami|google|kyoko|o-ren/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  jaVoice = ja.sort((a, b) => rank(b) - rank(a))[0] || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

function speak(text, el) {
  if (!window.speechSynthesis) { toast("Speech synthesis is not available in this browser."); return; }
  const token = ++playToken;
  player.pause();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  if (jaVoice) u.voice = jaVoice;
  else if (!speak.warned) { speak.warned = true; toast("No Japanese voice found; install a Japanese TTS voice for better audio."); }
  u.rate = settings.rate;
  setActive(el);
  u.onend = u.onerror = () => { if (token === playToken) setActive(null); };
  speechSynthesis.speak(u);
}

function playUrl(url, el, fallback, isPlaceholder) {
  const token = ++playToken;
  if (window.speechSynthesis) speechSynthesis.cancel();
  const fail = () => { if (token === playToken) fallback(); };
  player.onloadedmetadata = () => {
    if (token === playToken && isPlaceholder && isPlaceholder(player.duration)) { player.pause(); fail(); }
  };
  player.onerror = fail;
  player.onended = () => { if (token === playToken) setActive(null); };
  player.src = url;
  player.playbackRate = settings.rate;
  setActive(el);
  const p = player.play();
  if (p && p.catch) p.catch((e) => { if (e.name !== "AbortError") fail(); });
}

function playWord(row, el) {
  const [, kanji, kn] = row;
  const key = (kanji || kn) + "|" + kn;
  const tts = () => speak(kn, el);
  if (settings.wordAudio !== "rec" || missingWordAudio.has(key)) return tts();
  const url = "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=" +
    encodeURIComponent(kanji || kn) + "&kana=" + encodeURIComponent(kn);
  playUrl(url, el, () => {
    missingWordAudio.add(key);
    store.set("missingAudio", [...missingWordAudio].slice(-3000));
    tts();
  }, (d) => Math.abs(d - JPOD_PLACEHOLDER_SEC) < 0.4);
}

function playSentence(s, el) {
  const tts = () => speak(s[3].map((t) => t[0]).join(""), el);
  if (!s[2]) return tts();
  playUrl(`https://audio.tatoeba.org/sentences/jpn/${s[0]}.mp3`, el, tts);
}

function playToken_(tok, el) {
  const [surface, kn, rom] = tok;
  const particle = { wa: "わ", e: "え", o: "お" }[rom];
  speak(particle && kn.length === 1 ? particle : /[\u3040-\u30ff]/.test(kn) ? kn : surface, el);
}

// ---------------------------------------------------------------- definition panel
let defTok = null;

// Shows a lexicon entry; `tok` (optional) is the sentence token it was reached from.
function showDef(item, e, el, tok) {
  const [surface, tk, tr] = tok || [];
  if (defTok) defTok.classList.remove("defd");
  defTok = el;
  el.classList.add("defd");
  let html;
  if (!e) {
    html = `<div class="def-head"><span class="def-word static"><span class="def-rom">${esc(tr)}</span><span class="def-kana">${esc(kana(tk))}</span></span></div>` +
      `<p class="def-none">No dictionary entry for “${esc(surface)}”.</p>`;
  } else {
    const [kj, kn, rom, senses, rank, pos] = e;
    const head = kj || kn;
    const inflected = tok && surface !== head && surface !== kn;
    let rankHtml = "";
    if (rank === item.row[0]) rankHtml = `<span class="def-tag">this row’s word</span>`;
    else if (rank) rankHtml = `<button class="def-tag link" data-def="goto" data-rank="${rank}">#${rank} in list →</button>`;
    html = `<div class="def-head">` +
      `<button class="def-word" data-def="play" title="Play dictionary form"><span class="def-rom">${esc(rom)}</span>` +
      `<span class="def-kana">${esc(kana(kn))}</span>${kj ? `<span class="def-kanji">${esc(kj)}</span>` : ""}</button>` +
      (pos ? `<span class="def-pos">${esc(pos)}</span>` : "") + rankHtml + `</div>` +
      (inflected ? `<div class="def-form">in this sentence: <b>${esc(surface)}</b> · ${esc(kana(tk))} · ${esc(tr)}</div>` : "") +
      `<ol class="def-senses">${senses.map((g) => `<li>${esc(g.join("; "))}</li>`).join("")}</ol>`;
  }
  $("defInner").innerHTML = html;
  $("defbox").classList.remove("revealed");
  $("defbox").dataset.lex = e ? JSON.stringify([e[4], e[0], e[1]]) : "";
  $("defbox").hidden = false;
  document.body.classList.add("has-def");
}

function hideDef() {
  $("defbox").hidden = true;
  document.body.classList.remove("has-def");
  if (defTok) defTok.classList.remove("defd");
  defTok = null;
}

// ---------------------------------------------------------------- rendering
const SOURCES = {
  t: ["Tatoeba", (s) => `https://tatoeba.org/en/sentences/show/${s[0]}`],
  j: ["JMdict · Tatoeba", (s) => `https://tatoeba.org/en/sentences/show/${s[0]}`],
  w: ["Wiktionary", (s, row) => `https://en.wiktionary.org/wiki/${encodeURIComponent(row[1] || row[2])}#Japanese`],
};

function renderSentence(item) {
  const { row, lex } = item;
  const sents = row[5];
  if (!sents.length) return `<div class="no-sent">no example sentence found</div>`;
  const si = sentIdx.get(row[0]) || 0;
  const s = sents[si];
  const [, en, audioBy, toks, src] = s;
  const badge = audioBy ? ` <span class="badge" title="Recording by ${esc(audioBy)} (Tatoeba)">native</span>` : "";
  // Group each token with its trailing punctuation so punctuation never wraps onto its own line.
  const groups = [];
  toks.forEach(([surface, tk, tr, li], ti) => {
    if (!/[\p{L}\p{N}]/u.test(surface)) {
      const p = `<span class="punct"><span class="t-rom">&nbsp;</span><span class="t-kana">${esc(surface)}</span></span>`;
      if (groups.length) groups[groups.length - 1] += p; else groups.push(p);
      return;
    }
    const kj = surface !== tk ? esc(surface) : "&nbsp;";
    const target = li >= 0 && lex[li][4] === row[0] ? " target" : "";
    groups.push(`<button class="tok${target}" data-act="t" data-t="${ti}"><span class="t-rom">${esc(tr)}</span><span class="t-kana">${esc(kana(tk))}</span><span class="t-kanji">${kj}</span></button>`);
  });
  const [srcLabel, srcUrl] = SOURCES[src] || SOURCES.t;
  const counter = sents.length > 1 ? `<span class="s-count">${si + 1}/${sents.length}</span>` : "";
  return `<div class="s-body"><button class="s-en" data-act="s">${esc(en)}</button>${badge}` +
    `<div class="toks">${groups.map((g) => `<span class="tg">${g}</span>`).join("")}</div>` +
    `<div class="s-meta">${counter}<a class="src" href="${srcUrl(s, row)}" target="_blank" rel="noopener">${srcLabel} ↗</a></div></div>` +
    `<div class="s-side"><button class="side-btn play" data-act="s" aria-label="Play sentence">▶</button>` +
    (sents.length > 1 ? `<button class="side-btn" data-act="n" aria-label="Another example" title="Another example">↻</button>` : "") +
    `</div>`;
}

function renderRow(item, idx) {
  const [rank, kanji, kn, rom, gloss, , uk, jlpt] = item.row;
  const [first, ...rest] = gloss.split("; ");
  const kanjiLine = kanji ? (uk ? `${esc(kanji)} <small>usually kana</small>` : esc(kanji)) : "&nbsp;";
  return `<article class="row" data-i="${idx}" id="r${rank}">
  <div class="rank">${rank}${jlpt ? `<span class="jlpt" title="JLPT level">N${jlpt}</span>` : ""}</div>
  <div class="c-en"><button class="en-main" data-act="w">${esc(first)}</button>${rest.length ? `<span class="en-more">${esc(rest.join("; "))}</span>` : ""}</div>
  <div class="c-word"><button class="w-btn" data-act="w" aria-label="Play ${esc(kn)}"><span class="w-rom">${esc(rom)}</span><span class="w-kana">${esc(kana(kn))}</span><span class="w-kanji">${kanjiLine}</span></button></div>
  <div class="c-sent">${renderSentence(item)}</div>
</article>`;
}

function totalPages() { return Math.max(1, Math.ceil(filtered.length / settings.size)); }

function describeFilters() {
  const parts = [];
  if (filters.topic) parts.push(index.topics.find((t) => t.id === filters.topic).label);
  if (filters.jlpt) parts.push("JLPT N" + filters.jlpt);
  if (filters.pos) parts.push(index.posLabels[filters.pos]);
  return parts.length ? " · " + parts.join(" · ") : "";
}

let renderSeq = 0;
async function render(scrollTo) {
  const seq = ++renderSeq;
  stopAll();
  hideDef();
  const pages = totalPages();
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * settings.size;
  const ranks = filtered.slice(start, start + settings.size);
  $("status").textContent = "Loading…";
  try {
    const located = ranks.map(locate);
    const needed = [...new Set(located.map(([s, p]) => `${s}|${Math.floor(p / index.chunkSize)}`))];
    await Promise.all(needed.map((k) => { const [s, c] = k.split("|"); return loadChunk(s, +c); }));
    if (seq !== renderSeq) return;
    pageRows = located.map(([s, p]) => chunks[`${s}/${Math.floor(p / index.chunkSize)}`][p % index.chunkSize]);
  } catch (e) {
    $("status").textContent = "Could not load data: " + e.message;
    return;
  }
  $("list").innerHTML = pageRows.length ? pageRows.map(renderRow).join("") : `<p class="empty">No words match these filters.</p>`;
  $("status").textContent = filtered.length
    ? `Words ${start + 1}–${start + ranks.length} of ${filtered.length.toLocaleString()}${describeFilters()}` : "";
  $("page").value = page;
  $("pages").textContent = pages;
  $("first").disabled = $("prev").disabled = $("prevB").disabled = page <= 1;
  $("last").disabled = $("next").disabled = $("nextB").disabled = page >= pages;
  const h = new URLSearchParams({ page, size: settings.size });
  if (filters.topic) h.set("topic", filters.topic);
  if (filters.jlpt) h.set("jlpt", filters.jlpt);
  if (filters.pos) h.set("pos", filters.pos);
  const hash = "#" + h.toString();
  if (location.hash !== hash) history.replaceState(null, "", hash);
  store.set("page", page);
  if (scrollTo) {
    const el = document.getElementById("r" + scrollTo);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1500);
    }
  } else {
    window.scrollTo(0, 0);
  }
}

function go(p, scrollTo) { page = p; render(scrollTo); }

function applyFilters() {
  computeFiltered();
  renderFilterBar();
  go(1);
}

// Jump to a rank; clears filters that would hide it.
function goToRank(rank) {
  if (!filtered.includes(rank)) {
    filters.topic = ""; filters.jlpt = 0; filters.pos = "";
    computeFiltered();
    renderFilterBar();
    toast("Filters cleared to show #" + rank);
  }
  go(Math.floor(filtered.indexOf(rank) / settings.size) + 1, rank);
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

// ---------------------------------------------------------------- events
const itemOf = (el) => pageRows[+el.closest(".row").dataset.i];
const sentOf = (item) => item.row[5][sentIdx.get(item.row[0]) || 0];
const tokOf = (el) => sentOf(itemOf(el))[3][+el.dataset.t];
let lastPointerType = "mouse";

$("list").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  // Touch taps on sentence tokens are handled by the press logic below (tap = play, hold = jump to word).
  if (btn.dataset.act === "t" && ev.detail !== 0 && lastPointerType !== "mouse") return;
  const item = itemOf(btn);
  if (btn.dataset.act === "n") {
    const rank = item.row[0];
    sentIdx.set(rank, ((sentIdx.get(rank) || 0) + 1) % item.row[5].length);
    if (defTok && btn.closest(".row").contains(defTok)) hideDef();
    btn.closest(".c-sent").innerHTML = renderSentence(item);
    return;
  }
  if (btn === activeEl) { stopAll(); return; }
  if (btn.dataset.act === "w") {
    reveal(btn.closest(".row").querySelector(".c-word"));
    playWord(item.row, btn);
    if (item.row[9] >= 0) showDef(item, item.lex[item.row[9]], btn.closest(".row").querySelector(".w-btn"));
  }
  else if (btn.dataset.act === "s") { reveal(btn.closest(".c-sent")); playSentence(sentOf(item), btn); }
  else if (btn.dataset.act === "t") { reveal(btn); playToken_(tokOf(btn), btn); }
});

const defineTok = (tok) => {
  const item = itemOf(tok);
  const t = tokOf(tok);
  showDef(item, t[3] >= 0 ? item.lex[t[3]] : null, tok, t);
};
$("list").addEventListener("pointerover", (ev) => {
  const tok = ev.pointerType === "mouse" && ev.target.closest(".tok");
  if (tok && tok !== defTok) defineTok(tok);
});
$("list").addEventListener("focusin", (ev) => {
  const tok = ev.target.closest(".tok");
  if (tok && tok !== defTok && lastPointerType === "mouse") defineTok(tok);
});

const LONG_PRESS_MS = 450;
let press = null;
document.addEventListener("pointerdown", (ev) => { lastPointerType = ev.pointerType || "mouse"; }, true);
$("list").addEventListener("pointerdown", (ev) => {
  const tok = ev.pointerType !== "mouse" && ev.target.closest(".tok");
  if (!tok) return;
  press = { tok, id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: Date.now() };
  press.timer = setTimeout(() => {
    tok.classList.add("armed");
    if (navigator.vibrate) navigator.vibrate(12);
  }, LONG_PRESS_MS);
});
function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.tok.classList.remove("armed");
  press = null;
}
$("list").addEventListener("pointermove", (ev) => {
  if (press && ev.pointerId === press.id && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) endPress();
});
$("list").addEventListener("pointercancel", (ev) => { if (press && ev.pointerId === press.id) endPress(); });
// Play on release (not on the timer) so mobile browsers treat it as a user gesture for audio.
$("list").addEventListener("pointerup", (ev) => {
  if (!press || ev.pointerId !== press.id) return;
  const { tok, t } = press;
  endPress();
  if (Date.now() - t >= LONG_PRESS_MS) jumpToTokenWord(tok);
  else { reveal(tok); playToken_(tokOf(tok), tok); defineTok(tok); }
});

function jumpToTokenWord(tok) {
  const item = itemOf(tok);
  const li = tokOf(tok)[3];
  const rank = li >= 0 ? item.lex[li][4] : 0;
  if (!rank) toast("This word isn't in the top-word list.");
  else if (rank === item.row[0]) toast("That's this row's word.");
  else goToRank(rank);
}
$("list").addEventListener("contextmenu", (ev) => { if (ev.target.closest(".tok")) ev.preventDefault(); });

$("defbox").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-def]");
  if (!b) return;
  if (b.dataset.def === "play") {
    const [rank, kj, kn] = JSON.parse($("defbox").dataset.lex);
    reveal($("defbox"));
    playWord([rank, kj, kn], b);
  } else if (b.dataset.def === "goto") {
    goToRank(+b.dataset.rank);
  }
});
$("defClose").onclick = hideDef;

$("topics").addEventListener("click", (ev) => {
  const chip = ev.target.closest("[data-topic]");
  if (!chip) return;
  filters.topic = chip.dataset.topic === filters.topic ? "" : chip.dataset.topic;
  applyFilters();
});
$("jlpt").onchange = (e) => { filters.jlpt = +e.target.value; applyFilters(); };
$("pos").onchange = (e) => { filters.pos = e.target.value; applyFilters(); };
$("clearFilters").onclick = () => { filters.topic = ""; filters.jlpt = 0; filters.pos = ""; applyFilters(); };

$("first").onclick = () => go(1);
$("prev").onclick = $("prevB").onclick = () => go(page - 1);
$("next").onclick = $("nextB").onclick = () => go(page + 1);
$("last").onclick = () => go(totalPages());
$("page").onchange = (e) => go(parseInt(e.target.value, 10) || 1);
$("goto").onchange = (e) => {
  const rank = Math.min(Math.max(1, parseInt(e.target.value, 10) || 1), index.count);
  e.target.value = "";
  e.target.blur();
  goToRank(rank);
};
$("size").onchange = (e) => {
  const firstIdx = (page - 1) * settings.size;
  settings.size = +e.target.value;
  store.set("size", settings.size);
  go(Math.floor(firstIdx / settings.size) + 1);
};
$("script").onchange = (e) => { settings.script = e.target.value; store.set("script", settings.script); render(); };
$("kanji").onchange = (e) => {
  settings.kanji = e.target.checked;
  store.set("kanji", settings.kanji);
  applyDisplay();
};
$("order").onchange = (e) => { settings.order = e.target.value; store.set("order", settings.order); applyDisplay(); };
$("romaji").onchange = (e) => { settings.romaji = e.target.value; store.set("romaji", settings.romaji); applyDisplay(); };
$("wordAudio").onchange = (e) => { settings.wordAudio = e.target.value; store.set("wordAudio", settings.wordAudio); };
$("rate").oninput = (e) => { settings.rate = +e.target.value; store.set("rate", settings.rate); player.playbackRate = settings.rate; };

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowLeft" && page > 1) go(page - 1);
  else if (e.key === "ArrowRight" && page < totalPages()) go(page + 1);
  else if (e.key === "Escape") { stopAll(); hideDef(); }
});

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const hs = parseInt(h.get("size"), 10);
  if ([20, 50, 100].includes(hs)) settings.size = hs;
  const topic = h.get("topic") || "";
  filters.topic = index.topics.some((t) => t.id === topic) ? topic : "";
  filters.jlpt = Math.min(5, Math.max(0, parseInt(h.get("jlpt"), 10) || 0));
  filters.pos = index.posLabels[h.get("pos")] ? h.get("pos") : "";
  return parseInt(h.get("page"), 10);
}

window.addEventListener("hashchange", () => {
  const before = JSON.stringify([filters, settings.size]);
  const p = readHash();
  if (JSON.stringify([filters, settings.size]) !== before) { computeFiltered(); renderFilterBar(); go(p || 1); }
  else if (p && p !== page) go(p);
});

// ---------------------------------------------------------------- init
(async function init() {
  $("script").value = settings.script;
  $("kanji").checked = settings.kanji;
  $("wordAudio").value = settings.wordAudio;
  $("rate").value = String(settings.rate);
  $("order").value = settings.order;
  $("romaji").value = settings.romaji;
  applyDisplay();

  $("status").textContent = "Loading…";
  loadScript("data/index.js", () => { $("status").textContent = "data/index.js not found — run build_data.py first."; });
  await indexReady;
  for (const t of index.topics) topicRanks[t.id] = t.ranks;
  $("pos").innerHTML = `<option value="">Any</option>` +
    Object.entries(index.posLabels).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const p = readHash();
  page = p || store.get("page", 1);
  $("size").value = String(settings.size);
  $("built").textContent = `Data built ${index.built}.`;
  computeFiltered();
  renderFilterBar();
  render();
})();
