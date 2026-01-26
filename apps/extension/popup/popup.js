const DEFAULTS = {
  safeBrowsingEnabled: true,
  typingAssistEnabled: true,
  safeLevel: "low"
};

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("safeToggle").checked = !!stored.safeBrowsingEnabled;
  document.getElementById("typingToggle").checked = !!stored.typingAssistEnabled;
  document.getElementById("level").value = stored.safeLevel || "low";

  const on = stored.safeBrowsingEnabled ? "ON" : "OFF";
  const typing = stored.typingAssistEnabled ? "Typing ON" : "Typing OFF";
  setStatus(`${on} (${stored.safeLevel}) · ${typing}`);
}

async function broadcastSettingsChanged() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "EQ_SETTINGS_CHANGED" }).catch(() => {});
}

async function saveSettings() {
  const safeBrowsingEnabled = document.getElementById("safeToggle").checked;
  const typingAssistEnabled = document.getElementById("typingToggle").checked;
  const safeLevel = document.getElementById("level").value;

  await chrome.storage.sync.set({ safeBrowsingEnabled, typingAssistEnabled, safeLevel });

  const on = safeBrowsingEnabled ? "ON" : "OFF";
  const typing = typingAssistEnabled ? "Typing ON" : "Typing OFF";
  setStatus(`${on} (${safeLevel}) · ${typing}`);

  await broadcastSettingsChanged();
}

document.getElementById("applyBtn").addEventListener("click", saveSettings);
document.getElementById("safeToggle").addEventListener("change", saveSettings);
document.getElementById("typingToggle").addEventListener("change", saveSettings);
document.getElementById("level").addEventListener("change", saveSettings);

loadSettings();
