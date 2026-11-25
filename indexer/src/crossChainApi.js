const express = require("express");
const { ingestRawEvents, listDrivers } = require("./chains/drivers");
const { storeUnifiedEvents } = require("./chains/eventStore");
const { buildCrossChainTimeline } = require("./chains/timeline");

function createCrossChainRouter() {
  const router = express.Router();

  router.get("/drivers", (_req, res) => {
    res.json({
      drivers: listDrivers().map((driver) => ({
        name: driver.name,
        default_chain_id: driver.defaultChainId,
      })),
    });
  });

  router.post("/events/ingest", express.json(), (req, res) => {
    const { driver, events, chain_id: chainId } = req.body || {};
    if (!driver) {
      return res.status(400).json({ error: "driver is required" });
    }

    try {
      const { normalized, errors } = ingestRawEvents(driver, events || [], { chainId });
      const stored = storeUnifiedEvents(normalized);
      return res.status(errors.length ? 207 : 200).json({
        stored_count: stored.length,
        errors,
        events: stored,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.get("/timeline", (req, res) => {
    const { chain_id, limit, cursor } = req.query;
    const timeline = buildCrossChainTimeline({
      chain_id: chain_id ? String(chain_id) : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor: cursor ? String(cursor) : undefined,
    });
    return res.json(timeline);
  });

  return router;
}

module.exports = { createCrossChainRouter };
