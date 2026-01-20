"use client";

import { useMemo, useState } from "react";

type Finding = {
  rule_id: string;
  category: string;
  severity: string;
  description: string;
  start: number;
  end: number;
  match: string;
  rule_suggestions: string[];
};

type Tooltip = {
  explanation: string;
  suggestions: string[];
  confidence: number;
};

export default function Page() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [text, setText] = useState("You should man up and act like a man.");
  const [language, setLanguage] = useState<"auto" | "en" | "de" | "lv">("auto");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [active, setActive] = useState<Finding | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [loading, setLoading] = useState(false);

  async function scan() {
    setActive(null);
    setTooltip(null);

    const payload: any = { text };
    if (language !== "auto") payload.language = language;

    const res = await fetch(`${apiBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setFindings(data.findings || []);
  }

  async function explain(f: Finding) {
    setActive(f);
    setTooltip(null);
    setLoading(true);

    const payload: any = {
      text,
      start: f.start,
      end: f.end,
      category: f.category,
    };
    if (language !== "auto") payload.language = language;

    const res = await fetch(`${apiBase}/api/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    setTooltip(data);
    setLoading(false);
  }

  function applySuggestion(s: string) {
    if (!active) return;
    const next = text.slice(0, active.start) + s + text.slice(active.end);
    setText(next);
    setTimeout(() => scan(), 0);
  }

  const highlightedHTML = useMemo(() => {
    const escape = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\n", "<br/>");

    if (!findings.length) return escape(text);

    const sorted = [...findings].sort((a, b) => a.start - b.start);
    let out = "";
    let idx = 0;

    for (const f of sorted) {
      out += escape(text.slice(idx, f.start));
      const chunk = escape(text.slice(f.start, f.end));
      out += `<mark data-k="${f.rule_id}|${f.start}|${f.end}" style="background: rgba(255,0,0,0.22); border-bottom: 2px solid rgba(255,0,0,0.6); padding: 0 2px; border-radius: 4px;">${chunk}</mark>`;
      idx = f.end;
    }

    out += escape(text.slice(idx));
    return out;
  }, [text, findings]);

  function handleMarkEvent(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.tagName.toLowerCase() !== "mark") return;
    const key = t.getAttribute("data-k");
    if (!key) return;

    const [rule_id, startS, endS] = key.split("|");
    const start = Number(startS);
    const end = Number(endS);

    const f = findings.find((x) => x.rule_id === rule_id && x.start === start && x.end === end);
    if (f) explain(f);
  }

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>EqualType — Phase-1 Editor</h1>
      <p style={{ opacity: 0.75, marginBottom: 16 }}>Rule-first highlight + LLM tooltip (EN/DE/LV)</p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <select value={language} onChange={(e) => setLanguage(e.target.value as any)} style={{ padding: 8 }}>
          <option value="auto">Auto language</option>
          <option value="en">English</option>
          <option value="de">German</option>
          <option value="lv">Latvian</option>
        </select>

        <button onClick={scan} style={{ padding: "8px 12px", fontWeight: 700 }}>
          Scan
        </button>
      </div>

      <div style={{ position: "relative", border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: 14,
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            color: "transparent",
            pointerEvents: "auto",
            fontSize: 16,
            lineHeight: 1.6,
          }}
          onClick={handleMarkEvent}
          onMouseOver={handleMarkEvent}
          dangerouslySetInnerHTML={{ __html: highlightedHTML }}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            position: "relative",
            width: "100%",
            minHeight: 240,
            padding: 14,
            border: "none",
            outline: "none",
            resize: "vertical",
            fontSize: 16,
            lineHeight: 1.6,
            background: "transparent",
          }}
          placeholder="Paste your text here…"
        />
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Findings</h3>

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {findings.length === 0 && <div style={{ opacity: 0.7 }}>No findings yet. Click Scan.</div>}

            {findings.map((f) => (
              <button
                key={`${f.rule_id}-${f.start}-${f.end}`}
                onClick={() => explain(f)}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #eee",
                  background: active?.start === f.start && active?.rule_id === f.rule_id ? "#fafafa" : "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 800 }}>{f.match}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {f.category} • {f.severity} • {f.rule_id}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Tooltip</h3>

          {!active && <div style={{ marginTop: 10, opacity: 0.7 }}>Hover a red highlight or click a finding.</div>}

          {active && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>{active.match}</div>

              {loading && <div style={{ opacity: 0.7 }}>Thinking…</div>}

              {tooltip && (
                <>
                  <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>{tooltip.explanation}</div>

                  {tooltip.suggestions?.length > 0 && (
                    <>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>Suggestions</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {tooltip.suggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => applySuggestion(s)}
                            style={{
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid #eee",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>
                    confidence: {Math.round((tooltip.confidence || 0.5) * 100)}%
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>
        Backend: {apiBase} • Tip: Click “Scan” after edits (Phase-1).
      </div>
    </div>
  );
}
