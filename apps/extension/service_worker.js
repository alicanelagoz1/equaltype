chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "EQ_ANALYZE") return;

  (async () => {
    try {
      const res = await fetch("https://equaltype.com/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(message.payload)
      });

      if (!res.ok) {
        sendResponse({
          ok: false,
          status: res.status,
          error: `HTTP ${res.status}`
        });
        return;
      }

      const data = await res.json();

      sendResponse({
        ok: true,
        data
      });

    } catch (err) {
      sendResponse({
        ok: false,
        error: err.message || "Network error"
      });
    }
  })();

  // 🔴 BU SATIR OLMAZSA OLMAZ
  return true;
});
