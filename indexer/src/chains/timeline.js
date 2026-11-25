const { listStoredEvents } = require("./eventStore");

function encodeCursor(offset) {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  const parsed = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Build a unified cross-chain execution timeline (newest first).
 * @param {object} options
 * @param {string} [options.chain_id]
 * @param {number} [options.limit]
 * @param {string} [options.cursor]
 */
function buildCrossChainTimeline(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = decodeCursor(options.cursor);

  const filtered = listStoredEvents({ chain_id: options.chain_id });
  const sorted = filtered.sort((a, b) => {
    const timeDiff = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });

  const page = sorted.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < sorted.length;

  return {
    events: page,
    pagination: {
      limit,
      cursor: options.cursor || null,
      next_cursor: hasMore ? encodeCursor(nextOffset) : null,
      total: sorted.length,
    },
  };
}

module.exports = { buildCrossChainTimeline, encodeCursor, decodeCursor };
