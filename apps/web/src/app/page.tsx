"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import { trackEvent } from "@/lib/powermove";

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

function buildHighlightedHTML(
  text: string,
  findings: UIFinding[],
  goodSpan: { start: number; end: number } | null
) {
  // no findings + no goodSpan
  if ((!findings?.length || findings.length === 0) && !goodSpan) {
    return escapeHTML(text).replace(/\n/g, "<br/>");
  }

  type Span =
    | ({ kind: "finding" } & UIFinding)
    | { kind: "good"; id: string; start: number; end: number };

  const spans: Span[] = [];

  if (Array.isArray(findings) && findings.length) {
    spans.push(...findings.map((f) => ({ ...f, kind: "finding" as const })));
  }

  if (goodSpan && goodSpan.end > goodSpan.start) {
    spans.push({ kind: "good", id: "good_0", start: goodSpan.start, end: goodSpan.end });
  }

  // sort then remove overlaps (findings dominate)
  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  const cleaned: Span[] = [];
  let lastEnd = -1;

  for (const s of spans) {
    if (s.start < lastEnd) {
      if (s.kind === "good") continue;
      continue;
    }
    cleaned.push(s);
    lastEnd = s.end;
  }

  let out = "";
  let cursor = 0;

  for (const s of cleaned) {
    const start = clamp(s.start, 0, text.length);
    const end = clamp(s.end, 0, text.length);

    if (start > cursor) out += escapeHTML(text.slice(cursor, start));

    const raw = text.slice(start, end);

    if (s.kind === "good") {
      out += `<mark data-id="${escapeAttr(s.id)}" class="et_good">${escapeHTML(raw)}</mark>`;
    } else {
      const shown = s.type === "replace" ? (s.mask ?? raw) : raw;
      out += `<mark data-id="${escapeAttr(s.id)}" class="et_mark">${escapeHTML(shown)}</mark>`;
    }

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

function looksLikeSentenceSpan(original: string, spanLen: number) {
  const o = (original || "").trim();
  if (!o) return false;
  if (o.includes(" ")) return true;
  if (spanLen >= 20) return true;
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

  // NEW: lock prevents recursive re-analysis after user makes a decision
  const [locked, setLocked] = useState<boolean>(false);

  // ✅ NEW: success line (check + message)
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ✅ NEW: green highlight span after accepted replace
  const [goodSpan, setGoodSpan] = useState<{ start: number; end: number } | null>(null);
  const goodSpanTimerRef = useRef<number | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLDivElement | null>(null);
  const typeLineRef = useRef<HTMLDivElement | null>(null);

  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const lastTextRef = useRef<string>(text);
  const scanSeqRef = useRef<number>(0);

  // Debounce + max-wait (guarantee analyze runs even while typing)
  const debounceRef = useRef<number | null>(null);
  const maxWaitRef = useRef<number | null>(null);

  // NEW: allow exactly one analyze even if locked (used after Replace)
  const forcedAnalyzeOnceRef = useRef<boolean>(false);

  // Mobile detection (desktop functionality unchanged)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Power Move: page view
  useEffect(() => {
    trackEvent("page_view");
  }, []);

  function showSuccess(msg = "You’re communicating thoughtfully. Well done.") {
    setSuccessMessage(msg);
    // auto-hide after a moment (optional)
    window.setTimeout(() => setSuccessMessage(null), 2600);
  }

  function setGoodSpanTemp(span: { start: number; end: number }) {
    setGoodSpan(span);
    if (goodSpanTimerRef.current) window.clearTimeout(goodSpanTimerRef.current);
    goodSpanTimerRef.current = window.setTimeout(() => setGoodSpan(null), 1800);
  }

  function scheduleAnalyze(input: string) {
    if (locked) return;

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
  const highlightedHTML = useMemo(() => buildHighlightedHTML(text, findings, goodSpan), [text, findings, goodSpan]);

  async function analyze(input: string) {
    if (locked && !forcedAnalyzeOnceRef.current) return;

    const seq = ++scanSeqRef.current;

    if (!input.trim()) {
      setFindings([]);
      setActiveId(null);
      setCopyEnabled(false);
      setBlockedMessage(null);
      setSuccessMessage(null);
      setGoodSpan(null);
      return;
    }

    // reset maxWait once we actually run analyze
    if (maxWaitRef.current) {
      window.clearTimeout(maxWaitRef.current);
      maxWaitRef.current = null;
    }

    // Power Move: analysis started
    trackEvent("analysis_started", { text_length: input.length });

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
        setSuccessMessage(null);

        // Power Move: analysis failed (backend)
        trackEvent("analysis_failed", { text_length: input.length, status: res.status });

        return;
      }

      const mapped = mapAnyBackendToUI(data, input);

      // Power Move: analysis completed (mapped)
      trackEvent("analysis_completed", {
        text_length: input.length,
        copy_enabled: mapped.copy_enabled,
        flag_count: mapped.uiFindings?.length ?? 0,
        has_avoid: (mapped.uiFindings || []).some((f: any) => f.type === "avoid"),
      });

      // 1) If backend mislabeled sentence-level spans as replace, coerce them to avoid
      const normalized = coerceSentenceAvoid(mapped.uiFindings);

      // 2) Avoid dominates: remove replace spans overlapping any avoid spans
      const prio = prioritizeAvoid(normalized);

      setFindings(prio);
      setCopyEnabled(mapped.copy_enabled);

      // Power Move: flagged event
      if (prio.length > 0) {
        trackEvent("flagged_discriminative", {
          flag_count: prio.length,
          has_avoid: prio.some((f) => f.type === "avoid"),
          has_replace: prio.some((f) => f.type === "replace"),
        });
      }

      // ✅ show success if clean & copy enabled
      if (prio.length === 0 && mapped.copy_enabled) {
        setBlockedMessage(null);
        showSuccess("You’re communicating thoughtfully. Well done.");
      } else {
        setSuccessMessage(null);
      }

      if (mapped.popup_message) {
        setBlockedMessage(mapped.popup_message);
      } else if (!prio.length && mapped.copy_enabled === false) {
        setBlockedMessage("This wording may unintentionally exclude or stereotype some people. We recommend revising it.");
      }
    } catch (e: any) {
      setFindings([]);
      setActiveId(null);
      setCopyEnabled(false);
      setBlockedMessage(`Request failed: ${e?.message || String(e)}`);
      setSuccessMessage(null);

      // Power Move: analysis failed (network/runtime)
      trackEvent("analysis_failed", { text_length: input.length, error: e?.message || String(e) });
    } finally {
      if (forcedAnalyzeOnceRef.current) forcedAnalyzeOnceRef.current = false;
    }
  }

  // Auto-open the most important finding:
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
    if (isMobile) return;

    const root = displayRef.current;
    const wrap = wrapRef.current;
    const typeLine = typeLineRef.current;
    if (!root || !wrap || !typeLine) return;

    const el = root.querySelector(`mark[data-id="${CSS.escape(activeId)}"]`) as HTMLElement | null;
    if (!el) return;

    const markRect = el.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const lineRect = typeLineRef.current?.getBoundingClientRect() || typeLine.getBoundingClientRect();

    const x = markRect.left + markRect.width / 2 - wrapRect.left;
    const y = lineRect.top - wrapRect.top;

    setAnchor({ x, y });
  }, [activeId, findings, isMobile]);

  // NEW: smart single-space join so replacement doesn't stick to next word
  function joinWithSmartSpace(before: string, replacement: string, after: string) {
    const rep = replacement;
    if (!rep) return before + after;

    const afterFirst = after.slice(0, 1);
    const afterStartsSpace = /^\s$/.test(afterFirst) || after.startsWith("\n") || after.startsWith("\t");
    const afterStartsPunct = /^[,.;:!?)]$/.test(afterFirst);

    const repEndsSpace = /\s$/.test(rep);

    const repEndsWord = /[A-Za-z0-9)]$/.test(rep);
    const afterStartsWord = /^[A-Za-z0-9(]$/.test(afterFirst);

    const needsSpace = !repEndsSpace && !afterStartsSpace && !afterStartsPunct && repEndsWord && afterStartsWord;

    return before + rep + (needsSpace ? " " : "") + after;
  }

  function applyReplace(f: UIFinding) {
    if (f.type !== "replace") return;

    const replacement = (f.replacement ?? "").trim();
    if (!replacement || replacement.startsWith("(")) {
      setBlockedMessage("No safe replacement suggestion is available for this term yet.");
      setCopyEnabled(false);
      setActiveId(null);
      setSuccessMessage(null);
      return;
    }

    // Power Move: suggestion accepted (replace)
    trackEvent("suggestion_accepted", {
      type: "replace",
      original_length: (f.original || "").length,
      replacement_length: replacement.length,
    });

    const before = text.slice(0, f.start);
    const after = text.slice(f.end);
    const next = joinWithSmartSpace(before, replacement, after);

    // ✅ mark the newly inserted replacement as green for a moment
    const repStart = before.length;
    const repEnd = before.length + replacement.length;
    setGoodSpanTemp({ start: repStart, end: repEnd });

    setText(next);
    setFindings([]);
    setActiveId(null);
    setCopyEnabled(true);
    setBlockedMessage(null);

    // ✅ success reinforcement
    showSuccess("You’re communicating thoughtfully. Well done.");

    forcedAnalyzeOnceRef.current = true;
    analyze(next);
    setLocked(true);
  }

  function keepReplace() {
    // Power Move: suggestion rejected (replace)
    trackEvent("suggestion_rejected", { type: "replace" });

    setBlockedMessage(
      "This word has a long history of harm and exclusion. For this reason, it cannot be copied or used in this context. We strongly suggest revising it for inclusive language."
    );
    setCopyEnabled(false);
    setActiveId(null);

    setSuccessMessage(null);
    setGoodSpan(null);

    setLocked(true);
  }

  function acceptAvoid() {
    // Power Move: suggestion accepted (avoid)
    trackEvent("suggestion_accepted", { type: "avoid" });

    setText("");
    setFindings([]);
    setCopyEnabled(false);
    setBlockedMessage(null);
    setActiveId(null);

    // ✅ success reinforcement for removing harmful sentence
    showSuccess("You’re communicating thoughtfully. Well done.");

    setGoodSpan(null);
    setLocked(true);
  }

  function rejectAvoid() {
    // Power Move: suggestion rejected (avoid)
    trackEvent("suggestion_rejected", { type: "avoid" });

    setBlockedMessage("This wording may unintentionally exclude or stereotype some people. We recommend revising or avoiding it.");
    setCopyEnabled(false);
    setActiveId(null);

    setSuccessMessage(null);
    setGoodSpan(null);

    setLocked(true);
  }

  const popupStyle = useMemo(() => {
    if (!active) return { display: "none" as const };
    if (isMobile) return { display: "none" as const };
    if (!anchor) return { display: "none" as const };

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
  }, [anchor, active, isMobile]);

  async function onCopy() {
    // Power Move: copy clicked
    trackEvent("copy_clicked", { text_length: text.length, copy_enabled: copyEnabled });

    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  // iOS / mobile keyboard: real viewport height -> CSS var
  useEffect(() => {
    if (typeof window === "undefined") return;

    const setAppH = () => {
      const h = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${Math.round(h)}px`);
    };

    setAppH();

    window.addEventListener("resize", setAppH);
    window.addEventListener("orientationchange", setAppH);
    window.visualViewport?.addEventListener("resize", setAppH);
    window.visualViewport?.addEventListener("scroll", setAppH);

    return () => {
      window.removeEventListener("resize", setAppH);
      window.removeEventListener("orientationchange", setAppH);
      window.visualViewport?.removeEventListener("resize", setAppH);
      window.visualViewport?.removeEventListener("scroll", setAppH);
    };
  }, []);

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

        /* ✅ NEW: accepted replacement highlight */
        mark.et_good{background:transparent;color:${BRAND_GREEN};font-weight:700;padding:0 1px;}

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

        /* ✅ NEW: success row */
        .successRow{
          margin-top: 14px;
          display:flex;
          align-items:center;
          gap: 12px;
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size: 28px;
          font-weight: 600;
          color: ${BRAND_GREEN};
        }
        .successRow img{
          width: 44px;
          height: 44px;
          display:block;
        }

        /* Inline result panel (mobile only) */
        .inlinePanel{
          margin-top: 14px;
          background: #fff;
          border: 1px solid rgba(17,17,17,0.12);
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 10px 24px rgba(0,0,0,0.08);
        }
        .inlineTop{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
        }
        .inlineWord{
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:14px;
          line-height:1.3;
          font-weight:800;
          color:#111;
          flex:1;
          min-width: 0;
        }
        .inlineActions{
          display:flex;
          gap:10px;
          flex-shrink:0;
        }
        .inlineMsg{
          margin-top:8px;
          font-family:"Hanken Grotesk",system-ui;
          font-size:14px;
          color:#222;
        }

        /* -------------------------------------------------------
           MOBILE TYPO + EDITOR POLISH (desktop unchanged)
        ------------------------------------------------------- */
        @media (max-width: 560px){
          .container{
            padding: 18px 22px 22px;
          }

          /* TYPO */
          .title{
            font-size: 48px;
            line-height: 1.02;
            letter-spacing: -0.3px;
            margin-top: 26px;
          }

          .subtitle{
            font-size: 24px;
            line-height: 1.28;
            margin-top: 14px;
            max-width: 520px;
          }

          /* EDITOR */
          .editorWrap{
            margin-top: 18px;
            max-width: 100%;
          }

          .display{
            font-size: 24px;
            line-height: 1.35;
          }

          textarea.input{
            font-size: 24px;
            line-height: 1.35;
            min-height: 84px;
            padding-right: 64px;
          }

          textarea.input::placeholder{
            font-size: 18px;
            line-height: 1.25;
            opacity: 0.45;
          }

          .baseline{
            margin-top: 12px;
          }

          .copyBtn{
            right: 6px;
            bottom: -46px;
            width: 44px;
            height: 44px;
            border-radius: 10px;
            border: 1px solid rgba(17,17,17,0.18);
            background: rgba(255,255,255,0.35);
            backdrop-filter: blur(6px);
            opacity: 1;
          }

          .copyBtn img{
            width: 22px;
            height: 22px;
          }

          .blockedMsg{
            font-size: 14px;
            line-height: 1.35;
            margin-top: 14px;
            max-width: 520px;
          }

          /* Inline panel actions: allow wrap on very small screens */
          .inlineTop{
            flex-direction: column;
            gap: 10px;
          }
          .inlineActions{
            width:100%;
          }
          .inlineActions .btnPrimary,
          .inlineActions .btnSecondary{
            width: 50%;
            padding: 12px 10px;
          }

          /* Success row size on mobile */
          .successRow{
            font-size: 22px;
            line-height: 1.25;
          }
          .successRow img{
            width: 34px;
            height: 34px;
          }
        }
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
          {/* DESKTOP ONLY: keep existing popup behavior and visuals unchanged */}
          {!isMobile && active && (
            <div className="popup" style={popupStyle as any}>
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

              {active.type === "avoid" && (
                <div className="popupMsg">
                  This sentence may exclude or stereotype a group of people. Consider revising it to be more inclusive.
                </div>
              )}

              <div className="popupArrow" />
            </div>
          )}

          <div className="typeLine" ref={typeLineRef}>
            <div className="display" ref={displayRef} dangerouslySetInnerHTML={{ __html: highlightedHTML }} />

            <textarea
              className="input"
              value={text}
              onFocus={() => {
                if (typeof window === "undefined") return;
                if (!isMobile) return;

                window.setTimeout(() => {
                  typeLineRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
                }, 150);
              }}
              onChange={(e) => {
                const next = e.target.value;
                const prev = lastTextRef.current;

                // user started editing again -> unlock analysis
                if (locked) setLocked(false);

                setText(next);

                // Power Move: first character typed/pasted
                if (next.length > 0 && prev.length === 0) {
                  trackEvent("text_started", { text_length: next.length });
                }

                // clear success as user edits; it'll come back when clean
                if (successMessage) setSuccessMessage(null);

                if (!next.trim()) {
                  setFindings([]);
                  setActiveId(null);
                  setCopyEnabled(false);
                  setBlockedMessage(null);
                  setSuccessMessage(null);
                  setGoodSpan(null);
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

          {/* ✅ NEW: success row (desktop + mobile) */}
          {successMessage && <div className="successRow"><img src="/check.svg" alt="" />{successMessage}</div>}

          {/* MOBILE ONLY: inline result panel under the editor */}
          {isMobile && active && (
            <div className="inlinePanel">
              <div className="inlineTop">
                <div className="inlineWord">
                  {active.message ||
                    (active.type === "replace"
                      ? "We strongly suggest changing this word to a neutral term."
                      : "We suggest not using this sentence.")}
                </div>

                <div className="inlineActions">
                  {active.type === "replace" ? (
                    <>
                      <button className="btnPrimary" onClick={() => applyReplace(active)}>
                        Apply suggestion
                      </button>
                      <button className="btnSecondary" onClick={keepReplace}>
                        Keep original
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btnPrimary" onClick={acceptAvoid}>
                        Remove sentence
                      </button>
                      <button className="btnSecondary" onClick={rejectAvoid}>
                        Keep sentence
                      </button>
                    </>
                  )}
                </div>
              </div>

              {active.type === "replace" && (
                <div className="inlineMsg">
                  Suggested: <b>{(active.replacement ?? "").trim() || "(neutral alternative)"}</b>
                </div>
              )}

              {active.type === "avoid" && (
                <div className="inlineMsg">
                  This sentence may exclude or stereotype a group of people. Consider rephrasing it in a more inclusive way.
                </div>
              )}
            </div>
          )}

          {/* Keep existing blockedMessage behavior; avoid double messaging when mobile panel is visible */}
          {blockedMessage && (!isMobile || !active) && <div className="blockedMsg">{blockedMessage}</div>}
        </div>
      </div>
    </div>
  );
}
