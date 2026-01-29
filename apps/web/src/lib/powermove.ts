// src/lib/powermove.ts
// Safe, fire-and-forget tracker. Never throws, never blocks UI.

type PMPayload = Record<string, any>;

function getOrCreateSessionId() {
  if (typeof window === "undefined") return "server";
  const key = "pm_session_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function getOrPersistUtm() {
  if (typeof window === "undefined") return {};
  const key = "pm_utm";
  const existing = sessionStorage.getItem(key);
  if (existing) return JSON.parse(existing);

  const params = new URLSearchParams(window.location.search);
  const utm = {
    utm_source: params.get("utm_source") || "unknown",
    utm_medium: params.get("utm_medium") || "unknown",
    utm_campaign: params.get("utm_campaign") || "unknown",
    utm_content: params.get("utm_content") || "unknown",
  };

  sessionStorage.setItem(key, JSON.stringify(utm));
  return utm;
}

export function trackEvent(event: string, payload: PMPayload = {}) {
  try {
    if (typeof window === "undefined") return;

    const session_id = getOrCreateSessionId();
    const utm = getOrPersistUtm();

    // IMPORTANT: never send raw user text, only metadata
    const body = {
      event,
      session_id,
      ...utm,
      ts: new Date().toISOString(),
      url: window.location.pathname,
      user_agent: navigator.userAgent,
      payload,
    };

    // non-blocking
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // swallow
  }
}
