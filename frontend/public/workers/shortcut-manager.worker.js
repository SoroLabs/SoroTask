const shortcuts = [];

function normalizeCombo(combo) {
  return String(combo).trim().toLowerCase();
}

function eventToCombo(eventLike) {
  const parts = [];
  if (eventLike.ctrlKey) parts.push("ctrl");
  if (eventLike.metaKey) parts.push("meta");
  if (eventLike.altKey) parts.push("alt");
  if (eventLike.shiftKey) parts.push("shift");
  const key = String(eventLike.key || "").toLowerCase();
  if (key && !["control", "meta", "alt", "shift"].includes(key)) {
    parts.push(key);
  }
  return parts.join("+");
}

self.onmessage = function onmessage(event) {
  const message = event.data || {};

  try {
    if (message.type === "REGISTER_SHORTCUTS") {
      shortcuts.length = 0;
      const incoming = Array.isArray(message.payload) ? message.payload : [];
      for (const item of incoming) {
        if (!item || !item.id || !item.combo) continue;
        shortcuts.push({
          id: String(item.id),
          combo: normalizeCombo(item.combo),
          description: String(item.description || ""),
        });
      }
      self.postMessage({ type: "READY", payload: { count: shortcuts.length } });
      return;
    }

    if (message.type === "PROCESS_KEY_EVENT") {
      const combo = eventToCombo(message.payload || {});
      const matched = shortcuts.find((item) => item.combo === combo);
      self.postMessage({
        type: "SHORTCUT_RESULT",
        payload: {
          combo,
          matched: matched ? { id: matched.id, combo: matched.combo, description: matched.description } : null,
        },
      });
      return;
    }

    self.postMessage({ type: "IGNORED", payload: { reason: "unknown_message" } });
  } catch (error) {
    self.postMessage({
      type: "WORKER_ERROR",
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
