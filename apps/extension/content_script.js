/*************************************************
 * EqualType – LLM-only Typing Assist (via Background Proxy)
 * - Content script detects typing in inputs/contenteditable
 * - Sends to background: { type:"EQ_ANALYZE", payload:{...} }
 * - Background calls https://equaltype.com/api/analyze (server-side OpenAI)
 * - UI appears ONLY when backend suggests intervention (avoid/flag/rewrite)
 *************************************************/

const EQ_DEBUG = true;

const DEFAULTS = {
  typingAssistEnabled: true,
  safeLevel: "medium" // low | medium | high
};

const DEBOUNCE_MS = 650;
const MIN_TEXT_LEN = 10;

const EQ_UI_ID = "eq-typing-ui";

let activeField = null;
let typingTimer = null;

let lastRewrite = "";
let lastExplain = "";
let lastSeverity = "";
let lastMetaKey = "";
let requestSeq = 0;

/* =======================
   STORAGE
======================= */
function storageSyncGet(keys) {
  return new Promise((resolve) => {
    try {
      if (!globalThis.chrome?.storage?.sync?.get) return resolve({});
      chrome.storage.sync.get(keys, (items) => {
        try {
          if (chrome.runtime?.lastError) return resolve({});
          resolve(items || {});
        } catch {
          resolve({});
        }
      });
    } catch {
      resolve({});
    }
  });
}

async function getSettings() {
  const v = await storageSyncGet(DEFAULTS);
  return { ...DEFAULTS, ...(v || {}) };
}

/* =======================
   FIELD HELPERS
======================= */
function isTextInput(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "email", "url", "tel", "password"].includes(t);
  }
  return false;
}

function isEditable(el) {
  return !!(el && (isTextInput(el) || el.isContentEditable));
}

function getFieldText(el) {
  if (!el) return "";
  if (isTextInput(el)) return el.value || "";
  if (el.isContentEditable) {
    const t = el.innerText || el.textContent || "";
    return t.replace(/\u00A0/g, " ");
  }
  return "";
}

/**
 * contenteditable set: execCommand first (LinkedIn/Gmail safer),
 * fallback to manual replacement.
 */
function setContentEditableText(el, text) {
  // Try execCommand (works in many editors)
  try {
    el.focus();
    if (document.execCommand) {
      document.execCommand("selectAll", false, null);
      const ok = document.execCommand("insertText", false, text);
      if (ok) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
    }
  } catch {}

  // Fallback: wipe and insert text node
  try {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.deleteContents();
    el.appendChild(document.createTextNode(text));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  } catch {}

  return false;
}

function setFieldText(el, text) {
  if (!el) return false;

  if (isTextInput(el)) {
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (el.isContentEditable) return setContentEditableText(el, text);
  return false;
}

/* =======================
   UI
======================= */
function ensureTypingUI() {
  let ui = document.getElementById(EQ_UI_ID);
  if (ui) return ui;

  ui = document.createElement("div");
  ui.id = EQ_UI_ID;
  ui.style.position = "fixed";
  ui.style.zIndex = "2147483647";
  ui.style.minWidth = "320px";
  ui.style.maxWidth = "620px";
  ui.style.padding = "12px 12px";
  ui.style.borderRadius = "14px";
  ui.style.boxShadow = "0 10px 28px rgba(0,0,0,0.18)";
  ui.style.background = "white";
  ui.style.color = "#111";
  ui.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ui.style.fontSize = "13px";
  ui.style.display = "none";

  // prevent any autofocus side-effects
  ui.setAttribute("tabindex", "-1");
  ui.style.userSelect = "none";

  ui.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div style="min-width:170px;">
        <div style="font-weight:800;font-size:13px;">EqualType</div>
        <div id="eq-title" style="opacity:.9;margin-top:3px;font-weight:700;">—</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        <button id="eq-update" type="button" style="padding:6px 10px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;">Update</button>
        <button id="eq-keep" type="button" style="padding:6px 10px;border-radius:10px;border:1px solid #ddd;background:#fff;color:#111;">Keep</button>
      </div>
    </div>

    <div id="eq-explain" style="margin-top:8px; padding:10px; border-radius:12px; background:#f4f4f4; white-space:pre-wrap; line-height:1.35; display:none;"></div>

    <div id="eq-suggestion" style="margin-top:8px; padding:10px; border-radius:12px; background:#f7f7f7; white-space:pre-wrap; line-height:1.35; display:none;"></div>
  `;

  document.documentElement.appendChild(ui);

  const updateBtn = ui.querySelector("#eq-update");
  const keepBtn = ui.querySelector("#eq-keep");

  // prevent blur closing when clicking buttons
  const stopBlur = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  updateBtn.addEventListener("mousedown", stopBlur);
  keepBtn.addEventListener("mousedown", stopBlur);

  updateBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!activeField) return;
    if (!lastRewrite) return;

    const ok = setFieldText(activeField, lastRewrite);
    if (!ok) {
      showTypingUI("Couldn’t update this field automatically.", lastExplain, lastRewrite);
      return;
    }

    resetUIState();
    hideTypingUI();
  });

  keepBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetUIState();
    hideTypingUI();
  });

  return ui;
}

function resetUIState() {
  lastRewrite = "";
  lastExplain = "";
  lastSeverity = "";
}

function positionTypingUINear(el) {
  const ui = ensureTypingUI();
  const r = el.getBoundingClientRect();
  const pad = 10;

  let top = r.bottom + pad;
  let left = Math.min(r.left, window.innerWidth - 640);
  left = Math.max(10, left);

  if (top + 240 > window.innerHeight) top = Math.max(10, r.top - 240);

  ui.style.top = `${top}px`;
  ui.style.left = `${left}px`;
}

function showTypingUI(title, explanation, suggestion) {
  const ui = ensureTypingUI();
  ui.querySelector("#eq-title").textContent = title || "—";

  const ex = ui.querySelector("#eq-explain");
  const sg = ui.querySelector("#eq-suggestion");

  if (explanation && explanation.trim()) {
    ex.style.display = "block";
    ex.textContent = explanation.trim();
  } else {
    ex.style.display = "none";
    ex.textContent = "";
  }

  if (suggestion && suggestion.trim()) {
    sg.style.display = "block";
    sg.textContent = `Suggestion:\n${suggestion.trim()}`;
  } else {
    sg.style.display = "none";
    sg.textContent = "";
  }

  // Update active only when rewrite exists
  const updateBtn = ui.querySelector("#eq-update");
  if (updateBtn) {
    if (!lastRewrite) {
      updateBtn.style.opacity = "0.45";
      updateBtn.style.pointerEvents = "none";
    } else {
      updateBtn.style.opacity = "1";
      updateBtn.style.pointerEvents = "auto";
    }
  }

  ui.style.display = "block";
}

function hideTypingUI() {
  const ui = document.getElementById(EQ_UI_ID);
  if (ui) ui.style.display = "none";
}

/* =======================
   BACKEND (via background.js)
======================= */
function sendAnalyzeToBackground(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: "EQ_ANALYZE", payload }, (resp) => {
        const err = chrome.runtime?.lastError;
        if (err) return reject(new Error(err.message));
        if (!resp?.ok) return reject(new Error(resp?.error || `HTTP ${resp?.status || 0}`));
        resolve(resp.data);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/* =======================
   NORMALIZER (matches your backend schema)
   Observed response (from your screenshot):
   {
     status:"ok",
     overall:"avoid"|"clean",
     primary_action:"avoid"|"ok",
     actions:{...},
     popup_message:null|"..."
   }
======================= */
function toLower(x) {
  return (typeof x === "string" ? x : "").trim().toLowerCase();
}

function pickFirstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickFirstBool(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

function pickNested(obj, paths) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !(part in cur)) { ok = false; break; }
      cur = cur[part];
    }
    if (ok) return cur;
  }
  return undefined;
}

function normalizeResult(raw, originalText) {
  let result = raw;

  // unwrap common wrappers
  const nested = pickNested(result, ["data", "result", "analysis", "payload", "response"]);
  if (nested && typeof nested === "object") result = nested;

  // arrays
  if (Array.isArray(result)) result = result.find(x => x && typeof x === "object") || {};
  if (Array.isArray(result?.items)) result = result.items[0] || result;
  if (Array.isArray(result?.results)) result = result.results[0] || result;

  // your backend fields
  const overallRaw = pickFirstString(result, ["overall"]);              // clean | avoid | ...
  const primaryActionRaw = pickFirstString(result, ["primary_action"]); // ok | avoid | rewrite | ...
  const popupMessage = pickFirstString(result, ["popup_message", "message"]);

  const overall = toLower(overallRaw);
  const primaryAction = toLower(primaryActionRaw);

  // legacy fields (fallback)
  const decisionRaw = pickFirstString(result, ["decision", "action", "result", "status", "verdict", "intent"]);
  const decision = toLower(decisionRaw);

  const severity = pickFirstString(result, ["severity", "level", "rating", "tier", "risk"]);

  const actionsObj = (result && typeof result.actions === "object") ? result.actions : {};

  const explanation =
    pickFirstString(actionsObj, ["explanation", "reason", "message", "why", "rationale", "note", "feedback"]) ||
    popupMessage ||
    "";

  const rewrite =
    pickFirstString(actionsObj, [
      "rewritten_text",
      "rewrite",
      "rewrite_text",
      "suggestion",
      "suggested_text",
      "replacement",
      "output",
      "inclusive_text",
      "proposed_text",
      "fixed_text"
    ]) ||
    pickFirstString(result, [
      "rewritten_text",
      "rewrite",
      "rewrite_text",
      "suggestion",
      "suggested_text",
      "replacement",
      "output",
      "inclusive_text",
      "proposed_text",
      "fixed_text"
    ]) ||
    "";

  const flaggedBool = pickFirstBool(result, ["flagged", "is_discriminatory", "discriminatory", "unsafe", "blocked"]);
  const canCopyBool = pickFirstBool(result, ["can_copy", "copy_allowed"]);
  const copyDisabledBool = pickFirstBool(result, ["copy_disabled"]);

  const rewriteDiffers = !!rewrite && rewrite.trim() && rewrite.trim() !== originalText.trim();

  // ✅ intervention rules for your schema
  const overallIntervene = overall && overall !== "clean" && overall !== "ok";
  const primaryIntervene = primaryAction && primaryAction !== "ok" && primaryAction !== "clean";

  // legacy intervention rules
  const decisionIntervene =
    ["rewrite", "flag", "block", "replace", "suggest", "warn", "disable_copy", "avoid"].includes(decision) ||
    ["rewrite", "flag", "block", "replace", "suggest", "warn", "disable_copy", "avoid"].includes(primaryAction);

  const copyIntervene = (canCopyBool === false) || (copyDisabledBool === true);

  const shouldIntervene =
    overallIntervene ||
    primaryIntervene ||
    decisionIntervene ||
    flaggedBool === true ||
    copyIntervene ||
    rewriteDiffers;

  // fallback explanation if backend didn't send one
  let finalExplanation = explanation;
  if (shouldIntervene && !finalExplanation) {
    if (overall === "avoid" || primaryAction === "avoid") {
      finalExplanation =
        "This sentence may reinforce a stereotype or exclude a group. Consider using neutral, inclusive wording focused on context or behavior rather than identity.";
    } else {
      finalExplanation =
        "This sentence may be discriminatory. Consider revising it to be more neutral and inclusive.";
    }
  }

  return {
    shouldIntervene,
    severity: severity || overallRaw || "",
    explanation: finalExplanation || "",
    rewrite: (rewrite || "").trim(),
    decision: primaryActionRaw || decisionRaw || ""
  };
}

/* =======================
   ENGINE
======================= */
async function analyzeActiveField() {
  if (!activeField) return;

  const settings = await getSettings();
  if (!settings.typingAssistEnabled) return;

  const safeLevel = settings.safeLevel || "medium";
  const text = getFieldText(activeField);

  if (!text || text.trim().length < MIN_TEXT_LEN) {
    resetUIState();
    hideTypingUI();
    return;
  }

  // prevent re-sending same payload repeatedly
  const metaKey = `${safeLevel}::${location.hostname}::${text}`;
  if (metaKey === lastMetaKey) return;
  lastMetaKey = metaKey;

  const seq = ++requestSeq;

  const payload = {
    text,
    level: safeLevel,
    mode: "typing",
    lang: "en",
    context: {
      domain: location.hostname,
      url: location.href,
      fieldType: activeField?.isContentEditable
        ? "contenteditable"
        : (isTextInput(activeField) ? "input" : "unknown")
    }
  };

  if (EQ_DEBUG) console.log("[EQ CS] sending", payload);

  try {
    const raw = await sendAnalyzeToBackground(payload);
    if (seq !== requestSeq) return;

    if (EQ_DEBUG) {
      try {
        console.log("[EQ CS] received (json)", JSON.parse(JSON.stringify(raw)));
      } catch {
        console.log("[EQ CS] received (raw)", raw);
      }
    }

    const norm = normalizeResult(raw, text);

    if (EQ_DEBUG) console.log("[EQ CS] normalized", norm);

    if (!norm.shouldIntervene) {
      resetUIState();
      hideTypingUI();
      return;
    }

    lastRewrite = norm.rewrite || "";
    lastExplain = norm.explanation || "";
    lastSeverity = norm.severity || "";

    positionTypingUINear(activeField);

    const sev = lastSeverity ? String(lastSeverity).toUpperCase() : "FLAGGED";
    const title = `Discriminatory sentence detected: ${sev}`;

    showTypingUI(title, lastExplain, lastRewrite);
  } catch (e) {
    if (EQ_DEBUG) console.warn("[EQ CS] analyze failed", e);
    resetUIState();
    hideTypingUI();
  }
}

function scheduleTypingAnalyze() {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => analyzeActiveField(), DEBOUNCE_MS);
}

/* =======================
   LISTENERS
======================= */
function attachTypingListeners() {
  document.addEventListener(
    "focusin",
    async (e) => {
      const el = e.target;
      const settings = await getSettings();
      if (!settings.typingAssistEnabled) return;
      if (!isEditable(el)) return;

      activeField = el;
      if (EQ_DEBUG) console.log("[EQ CS] focusing", el);
      scheduleTypingAnalyze();
    },
    true
  );

  document.addEventListener(
    "input",
    (e) => {
      if (!activeField) return;
      if (e.target !== activeField) return;
      scheduleTypingAnalyze();
    },
    true
  );

  // blur closes UI (unless click inside UI)
  document.addEventListener(
    "focusout",
    (e) => {
      if (!activeField) return;
      if (e.target !== activeField) return;

      const ui = document.getElementById(EQ_UI_ID);
      const next = e.relatedTarget;

      if (ui && next && ui.contains(next)) return;

      resetUIState();
      hideTypingUI();
      activeField = null;
    },
    true
  );
}

/* =======================
   SETTINGS CHANGES
======================= */
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "EQ_SETTINGS_CHANGED") {
      if (EQ_DEBUG) console.log("[EQ CS] settings changed");
      // no reattach needed for MVP
    }
  });
} catch {}

/* =======================
   INIT
======================= */
console.log("[EQ CS] content_script loaded on", location.href);
attachTypingListeners();
