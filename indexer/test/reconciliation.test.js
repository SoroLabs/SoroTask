const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRepairPlan,
  compareTaskState,
  mapOnChainTask,
} = require("../src/reconciliation");

test("maps on-chain task values into the indexed task model", () => {
  const mapped = mapOnChainTask(9, {
    creator: "creator",
    target: "target",
    function: "execute",
    args: ["a"],
    resolver: null,
    interval: 60n,
    last_run: 5n,
    gas_balance: 123n,
    whitelist: ["keeper"],
    is_active: true,
    blocked_by: [1],
  });

  assert.equal(mapped.task_id, 9);
  assert.equal(mapped.interval, 60);
  assert.equal(mapped.gas_balance, "123");
  assert.equal(mapped.args_json, JSON.stringify(["a"]));
});

test("detects and classifies drift between indexed and chain state", () => {
  const comparison = compareTaskState(
    {
      creator: "creator",
      target: "target",
      function: "execute",
      args_json: "[]",
      resolver: null,
      interval: 60,
      last_run: 1,
      gas_balance: "10",
      whitelist_json: "[]",
      is_active: 1,
      blocked_by_json: "[]",
    },
    {
      creator: "creator",
      target: "target",
      function: "execute",
      args_json: "[]",
      resolver: null,
      interval: 60,
      last_run: 2,
      gas_balance: "5",
      whitelist_json: "[]",
      is_active: false,
      blocked_by_json: "[]",
    },
  );

  assert.equal(comparison.status, "drift");
  assert.equal(comparison.likelyCause, "missed_lifecycle_event");
  assert.deepEqual(
    comparison.mismatches.map((item) => item.field),
    ["last_run", "gas_balance", "is_active"],
  );
});

test("builds safe repair plans for common reconciliation outcomes", () => {
  assert.deepEqual(buildRepairPlan({ status: "in_sync", mismatches: [] }).action, "none");

  const missingOnChainPlan = buildRepairPlan({
    status: "missing_on_chain",
    mismatches: [],
  });
  assert.equal(missingOnChainPlan.destructive, true);
  assert.equal(missingOnChainPlan.requiresReview, true);

  const driftPlan = buildRepairPlan({
    status: "drift",
    mismatches: [{ classification: "funding" }],
  });
  assert.equal(driftPlan.action, "upsert_from_chain");
  assert.equal(driftPlan.destructive, false);
});
