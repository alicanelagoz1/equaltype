"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";

type UIFinding = {
  id: string;
  type: "replace" | "avoid";
  start: number;
  end: number;
  original: string;
  mask?: string | null;
  message: string;
  replacement?: string | null;
  confidence?: number;
};

const BG_PINK = "#FFDEF0";
const BRAND_GREEN = "#1B8900";
const UNDERLINE_RED = "#FF0000";
const ACCEPT_GREEN = "#047B67";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function escapeHTML(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s: string) {
  return s.replaceAll('"', "&quot;");
}

function buildHighlightedHTML(text: string, findings: UIFinding[]) {
  if (!findings?.length) return escapeHTML(text).replace(/\n/g, "<br/>");

  const sorted = [...findings].sort((a, b) => a.start - b.start || b.end - a.end);

  // remove overlaps (keep earliest; our prioritize step handles avoid dominance)
  const cleaned: UIFinding[] = [];
  let lastEnd = -1;
  for (const f of sorted) {
    if (f.start < lastEnd) continue;
    cleaned.push(f);
    lastEnd = f.end;
  }

  let out = "";
  let cursor = 0;

  for (const f of cleaned) {
    const start = clamp(f.start, 0, text.length);
    const end = clamp(f.end, 0, text.length);

    if (start > cursor) out += escapeHTML(text.slice(cursor, start));

    const raw = text.slice(start, end);
    const shown = f.type === "replace" ? (f.mask ?? raw) : raw;

    out += `<mark data-id="${escapeAttr(f.id)}" class="et_mark">${escapeHTML(shown)}</mark>`;
    cursor = end;
  }

  if (cursor < text.length) out += escapeHTML(text.slice(cursor));
  return out.replace(/\n/g, "<br/>");
}

function shouldScanNow(newText: string, oldText: string) {
  if (newText.length <= oldText.length) return false;
  const added = newText.slice(oldText.length);
  return /[.!?]\s*$/.test(added) || /\n$/.test(added);
}

function makeId(prefix: string, idx: number, start: number, end: number) {
  return `${prefix}_${idx}_${start}_${end}`;
}

function toStr(v: any): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function firstNonEmpty(...vals: any[]): string | null {
  for (const v of vals) {
    const s = toStr(v).trim();
    if (s) return s;
  }
  return null;
}

function numOrNull(v: any): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickList(anyData: any): any[] | null {
  const listKeys = ["findings", "issues", "spans", "matches", "results", "items", "highlights", "flags"];
  for (const k of listKeys) {
    if (Array.isArray(anyData?.[k])) return anyData[k];
  }
  if (anyData?.data && typeof anyData.data === "object") {
    for (const k of listKeys) {
      if (Array.isArray(anyData.data?.[k])) return anyData.data[k];
    }
  }
  return null;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

// Prefer sentence-level "avoid" over word-level "replace" when they overlap
function prioritizeAvoid(findings: UIFinding[]) {
  const avoids = findings.filter((f) => f.type === "avoid");
  if (!avoids.length) return findings;

  return findings.filter((f) => {
    if (f.type !== "replace") return true;
    return !avoids.some((a) => overlaps(a, f));
  });
}

// Heuristic: backend may mislabel sentence-level issues as "replace".
// If span looks sentence-like AND no usable replacement exists, treat it as "avoid".
function looksLikeSentenceSpan(original: string, spanLen: number) {
  const o = (original || "").trim();
  if (!o) return false;
  if (o.includes(" ")) return true; // phrases/sentences contain spaces
  if (spanLen >= 20) return true; // long spans are likely sentence-level
  if (/[.!?]/.test(o)) return true;
  return false;
}

function coerceSentenceAvoid(findings: UIFinding[]) {
  return findings.map((f) => {
    const spanLen = Math.max(0, f.end - f.start);
    const sentencey = looksLikeSentenceSpan(f.original, spanLen);
    const hasReplacement = !!String(f.replacement || "").trim();

    if (f.type === "replace" && sentencey && !hasReplacement) {
      return { ...f, type: "avoid" as const };
    }
    return f;
  });
}

function mapAnyBackendToUI(anyData: any, inputText: string): {
  uiFindings: UIFinding[];
  copy_enabled: boolean;
  popup_message: string | null;
} {
  const copy_enabled =
    typeof anyData?.actions?.copy_enabled === "boolean"
      ? anyData.actions.copy_enabled
      : typeof anyData?.can_copy === "boolean"
      ? anyData.can_copy
      : typeof anyData?.copy_enabled === "boolean"
      ? anyData.copy_enabled
      : true;

  const popup_message =
    firstNonEmpty(anyData?.popup_message, anyData?.reason, anyData?.message, anyData?.detail, anyData?.warning) ??
    null;

  const list = pickList(anyData);

  if (Array.isArray(list) && list.length) {
    const uiFindings: UIFinding[] = [];

    for (let idx = 0; idx < list.length; idx++) {
      const it = list[idx];

      const start = numOrNull(it?.start ?? it?.span_start ?? it?.from ?? it?.begin);
      const end = numOrNull(it?.end ?? it?.span_end ?? it?.to ?? it?.finish);

      let finalStart = start;
      let finalEnd = end;

      const originalCandidate =
        firstNonEmpty(it?.original, it?.term, it?.text, it?.token, it?.match, it?.value) ?? "";

      if ((finalStart == null || finalEnd == null) && originalCandidate) {
        const foundAt = inputText.toLowerCase().indexOf(originalCandidate.toLowerCase());
        if (foundAt >= 0) {
          finalStart = foundAt;
          finalEnd = foundAt + originalCandidate.length;
        }
      }

      if (finalStart == null || finalEnd == null) continue;

      const tRaw = toStr(it?.type ?? it?.action ?? it?.kind ?? it?.category ?? it?.label).toLowerCase();

      const type: "replace" | "avoid" =
        tRaw === "avoid" || tRaw === "block" || tRaw === "disallow" || tRaw === "reject"
          ? "avoid"
          : "replace";

      const sug0 = Array.isArray(it?.suggestions) ? it.suggestions?.[0] : null;

      const replacement =
        firstNonEmpty(
          sug0?.replacement,
          sug0?.text,
          it?.replacement,
          it?.suggested,
          it?.suggestion,
          it?.suggested_replacement,
          it?.best_replacement,
          it?.neutral,
          it?.neutral_term,
          it?.alternative,
          Array.isArray(it?.alternatives) ? it.alternatives?.[0] : null,
          Array.isArray(it?.suggestions) ? it.suggestions?.[0]?.replacement : null,
          it?.alt
        ) ?? null;

      const message =
        firstNonEmpty(
          sug0?.message,
          it?.message,
          it?.reason,
          popup_message,
          type === "avoid"
            ? "We suggest not using this sentence."
            : "We strongly suggest changing this word to a neutral term."
        ) ??
        (type === "avoid"
          ? "We suggest not using this sentence."
          : "We strongly suggest changing this word to a neutral term.");

      const mask = firstNonEmpty(it?.mask, it?.masked, it?.masked_text) ?? null;

      uiFindings.push({
        id: makeId("f", idx, finalStart, finalEnd),
        type,
        start: finalStart,
        end: finalEnd,
        original: originalCandidate || inputText.slice(finalStart, finalEnd),
        mask,
        message,
        replacement: type === "replace" ? replacement : null,
        confidence: typeof it?.confidence === "number" ? it.confidence : undefined,
      });
    }

    return { uiFindings, copy_enabled, popup_message };
  }

  return { uiFindings: [], copy_enabled, popup_message };
}

export default function Page() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const [text, setText] = useState<string>("");
  const [findings, setFindings] = useState<UIFinding[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [copyEnabled, setCopyEnabled] = useState<boolean>(true);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLDivElement | null>(null);
  const typeLineRef = useRef<HTMLDivElement | null>(null);

  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const lastTextRef = useRef<string>(text);
  const scanSeqRef = useRef<number>(0);

  // Debounce + max-wait (guarantee analyze runs even while typing)
  const debounceRef = useRef<number | null>(null);
  const maxWaitRef = useRef<number | null>(null);

  function scheduleAnalyze(input: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => analyze(input), 550);

    // max wait: if user keeps typing, still analyze every 1200ms
    if (!maxWaitRef.current) {
      maxWaitRef.current = window.setTimeout(() => {
        maxWaitRef.current = null;
        analyze(input);
      }, 1200);
    }
  }

  const active = useMemo(() => findings.find((f) => f.id === activeId) || null, [findings, activeId]);
  const highlightedHTML = useMemo(() => buildHighlightedHTML(text, findings), [text, findings]);

  async function analyze(input: string) {
    const seq = ++scanSeqRef.current;

    if (!input.trim()) {
      setFindings([]);
      setActiveId(null);
      setCopyEnabled(false);
      setBlockedMessage(null);
      return;
    }

    // reset maxWait once we actually run analyze
    if (maxWaitRef.current) {
      window.clearTimeout(maxWaitRef.current);
      maxWaitRef.current = null;
    }

    try {
      const res = await fetch(`${apiBase}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, locale: "en-US", context: {} }),
      });

      const raw = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }

      if (seq !== scanSeqRef.current) return;

      if (!res.ok || !data) {
        setFindings([]);
        setActiveId(null);
        setCopyEnabled(false);
        setBlockedMessage(`Backend error (${res.status}). ${raw?.slice(0, 240) || "No response body"}`);
        return;
      }

      const mapped = mapAnyBackendToUI(data, input);

      // 1) If backend mislabeled sentence-level spans as replace, coerce them to avoid
      const normalized = coerceSentenceAvoid(mapped.uiFindings);

      // 2) Avoid dominates: remove replace spans overlapping any avoid spans
      const prio = prioritizeAvoid(normalized);

      setFindings(prio);
      setCopyEnabled(mapped.copy_enabled);

      if (mapped.popup_message) {
        setBlockedMessage(mapped.popup_message);
      } else if (!prio.length && mapped.copy_enabled === false) {
        setBlockedMessage("This wording may unintentionally exclude or stereotype some people. We recommend revising it.");
      } else if (prio.length === 0) {
        if (mapped.copy_enabled) setBlockedMessage(null);
      }
    } catch (e: any) {
      setFindings([]);
      setActiveId(null);
      setCopyEnabled(false);
      setBlockedMessage(`Request failed: ${e?.message || String(e)}`);
    }
  }

  // Auto-open the most important finding:
  // prefer avoid (sentence-level), otherwise replace
  useEffect(() => {
    if (activeId) return;
    if (!findings.length) return;

    const candidate =
      findings.find((f) => f.type === "avoid") ||
      findings.find((f) => f.type === "replace") ||
      findings[0];

    if (candidate) setActiveId(candidate.id);
  }, [findings, activeId]);

  // Compute popup anchor (position above the highlighted span)
  useEffect(() => {
    if (!activeId) return;

    const root = displayRef.current;
    const wrap = wrapRef.current;
    const typeLine = typeLineRef.current;
    if (!root || !wrap || !typeLine) return;

    const el = root.querySelector(`mark[data-id="${CSS.escape(activeId)}"]`) as HTMLElement | null;
    if (!el) return;

    const markRect = el.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const lineRect = typeLine.getBoundingClientRect();

    const x = markRect.left + markRect.width / 2 - wrapRect.left;
    const y = lineRect.top - wrapRect.top;

    setAnchor({ x, y });
  }, [activeId, findings]);

  function applyReplace(f: UIFinding) {
    if (f.type !== "replace") return;

    const replacement = (f.replacement ?? "").trim();
    if (!replacement || replacement.startsWith("(")) {
      setBlockedMessage("No safe replacement suggestion is available for this term yet.");
      setCopyEnabled(false);
      setActiveId(null);
      return;
    }

    const before = text.slice(0, f.start);
    const after = text.slice(f.end);
    const next = before + replacement + after;

    setText(next);
    setFindings([]);
    setActiveId(null);
    setCopyEnabled(true);
    setBlockedMessage(null);

    scheduleAnalyze(next);
  }

  function keepReplace() {
    setBlockedMessage(
      "This word has a long history of harm and exclusion. For this reason, it cannot be copied or used in this context. We strongly suggest revising it for inclusive language."
    );
    setCopyEnabled(false);
    setActiveId(null);
  }

  function acceptAvoid() {
    setText("");
    setFindings([]);
    setCopyEnabled(false);
    setBlockedMessage(null);
    setActiveId(null);
  }

  function rejectAvoid() {
    setBlockedMessage("This wording may unintentionally exclude or stereotype some people. We recommend revising or avoiding it.");
    setCopyEnabled(false);
    setActiveId(null);
  }

  const popupStyle = useMemo(() => {
    if (!anchor || !active) return { display: "none" as const };

    const bubbleW = 360;
    const wrapW = wrapRef.current?.clientWidth || bubbleW;

    let left = anchor.x - bubbleW / 2;
    left = clamp(left, 12, wrapW - bubbleW - 12);

    const top = anchor.y - 12;
    const arrowLeft = clamp(anchor.x - left, 18, bubbleW - 18);

    return {
      position: "absolute" as const,
      left,
      top,
      width: bubbleW,
      transform: "translateY(-100%)",
      ["--arrow-left" as any]: `${arrowLeft}px`,
    };
  }, [anchor, active]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  return (
    <div className="page">
      <style>{`
        @font-face{font-family:"Seatren";src:url("/fonts/Seatren.woff") format("woff");font-weight:400;font-style:normal;font-display:swap;}
        @font-face{font-family:"Hanken Grotesk";src:url("/fonts/HankenGrotesk-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap;}
        @font-face{font-family:"Hanken Grotesk";src:url("/fonts/HankenGrotesk-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap;}

        .page{flex:1;background:#FFDEF0;position:relative;overflow-x:hidden;overflow-y:hidden;display:flex;flex-direction:column;}
        .container{position:relative;max-width:1100px;margin:0 auto;padding:24px 64px 24px;display:flex;flex-direction:column;z-index:1;}
        .hero{text-align:left;margin-top:24px;max-width:820px;}
        .title{font-family:"Seatren",system-ui,-apple-system,Segoe UI,Arial;font-size:64px;line-height:1;color:${BRAND_GREEN};margin:clamp(18px,3vh,48px) 0 0;font-weight:400;}
        .subtitle{font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:36px;margin:18px 0 0;max-width:900px;color:#111;}
        .subtitle b{font-weight:800;}
        .siteWrap{min-height:100dvh;display:flex;flex-direction:column;}


        .editorWrap{position:relative;margin:22px 0 0;width:100%;max-width:820px;}
        .typeLine{position:relative;padding:0;margin:0;width:100%;}

        .display{position:absolute;inset:0;z-index:2;font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:24px;line-height:normal;color:#111;white-space:pre-wrap;word-break:break-word;pointer-events:none;}
        textarea.input{position:relative;z-index:3;width:100%;min-height:64px;border:none;outline:none;resize:none;background:transparent;font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:24px;line-height:normal;color:transparent;caret-color:#111;}

        .baseline{height:2px;background:#111;margin-top:14px;width:100%;}

        mark.et_mark{background:transparent;color:${UNDERLINE_RED};position:relative;padding:0 1px;font-weight:400;}
        mark.et_mark::after{content:"";position:absolute;left:0;right:0;top:52%;height:3px;background:${UNDERLINE_RED};transform:translateY(-50%);}

        .popup{background:#fff;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,0.15);padding:14px;z-index:20;}
        .popupArrow{position:absolute;left:var(--arrow-left,22px);bottom:-10px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:10px solid #fff;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.08));}

        .popupTop{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
        .popupWord{font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:16px;line-height:1.25;font-weight:800;color:#111;max-width:220px;}
        .btnRow{display:flex;align-items:center;gap:10px;flex-shrink:0;}
        .btnPrimary{background:${ACCEPT_GREEN};color:#fff;border:none;border-radius:8px;padding:10px 14px;font-family:"Hanken Grotesk",system-ui;font-size:14px;font-weight:800;cursor:pointer;}
        .btnSecondary{background:transparent;border:1px solid #ddd;border-radius:8px;padding:10px 14px;font-family:"Hanken Grotesk",system-ui;font-size:14px;font-weight:800;cursor:pointer;color:#111;}
        .popupMsg{margin-top:8px;font-family:"Hanken Grotesk",system-ui;font-size:14px;color:#222;}

        .blockedMsg{margin-top:10px;text-align:left;font-family:"Hanken Grotesk",system-ui;font-size:14px;color:#222;opacity:.95;}

        .copyBtn{position:absolute;right:0;bottom:-40px;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:none;background:transparent;cursor:pointer;opacity:.9;}
        .copyBtn img{width:22px;height:22px;display:block;}
        .copyDisabled{opacity:.35;cursor:not-allowed;}
      `}</style>

      <div className="loopBg" />

      <div className="container">

        <div className="hero">
          <h1 className="title">Write better for everyone</h1>
          <p className="subtitle">
            EqualType helps you write with clarity and respect,
            <br />
            <b>so your words work better for everyone.</b>
          </p>
        </div>

        <div className="editorWrap" ref={wrapRef}>
          {active && (
            <div className="popup" style={popupStyle}>
              <div className="popupTop">
                <div className="popupWord">
                  {active.message ||
                    (active.type === "replace"
                      ? "We strongly suggest changing this word to a neutral term."
                      : "We suggest not using this sentence.")}
                </div>

                <div className="btnRow">
                  {active.type === "replace" ? (
                    <>
                      <button className="btnPrimary" onClick={() => applyReplace(active)}>
                        Change
                      </button>
                      <button className="btnSecondary" onClick={keepReplace}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btnPrimary" onClick={acceptAvoid}>
                        Accept
                      </button>
                      <button className="btnSecondary" onClick={rejectAvoid}>
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>

              {active.type === "replace" && (
                <div className="popupMsg">
                  Suggested: <b>{(active.replacement ?? "").trim() || "(neutral alternative)"}</b>
                </div>
              )}

              {active.type === "avoid" && <div className="popupMsg">{active.message}</div>}

              <div className="popupArrow" />
            </div>
          )}

          <div className="typeLine" ref={typeLineRef}>
            <div className="display" ref={displayRef} dangerouslySetInnerHTML={{ __html: highlightedHTML }} />

            <textarea
              className="input"
              value={text}
              onChange={(e) => {
                const next = e.target.value;
                const prev = lastTextRef.current;

                setText(next);

                if (!next.trim()) {
                  setFindings([]);
                  setActiveId(null);
                  setCopyEnabled(false);
                  setBlockedMessage(null);
                  lastTextRef.current = next;
                  return;
                }

                if (shouldScanNow(next, prev)) {
                  analyze(next);
                } else {
                  scheduleAnalyze(next);
                }

                lastTextRef.current = next;
              }}
              placeholder="Write something here"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />

            <button
              className={`copyBtn ${copyEnabled ? "" : "copyDisabled"}`}
              onClick={onCopy}
              disabled={!copyEnabled || !text.trim()}
              aria-label="Copy"
              title={!copyEnabled ? "Resolve issues to enable copy" : "Copy"}
            >
              <img src="/icons/copy.svg" alt="" />
            </button>

            <div className="baseline" />
          </div>

          {blockedMessage && <div className="blockedMsg">{blockedMessage}</div>}
        </div>
      </div>
    </div>
  );
}
