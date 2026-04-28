export type MockTaskStatus = "pending" | "running" | "success" | "failed";

export interface MockTask {
  id: string;
  title: string;
  contract: string;
  fn: string;
  intervalSec: number;
  gas: number;
  status: MockTaskStatus;
  description: string;
}

const STATUSES: MockTaskStatus[] = ["pending", "running", "success", "failed"];

const FUNCTIONS = [
  "harvest_yield",
  "rebalance",
  "claim_rewards",
  "compound",
  "settle_position",
  "rotate_keys",
  "snapshot",
  "ping",
];

// A small deterministic PRNG so the demo data is stable between renders.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickContract(rand: () => number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "C";
  for (let i = 0; i < 55; i++) {
    out += chars[Math.floor(rand() * chars.length)];
  }
  return out;
}

function pickDescription(rand: () => number, fn: string): string {
  // Variable-length text drives variable-height cards in the demo.
  const sentenceCount = 1 + Math.floor(rand() * 4);
  const fragments = [
    `Automated invocation of ${fn}.`,
    "Runs on the configured cadence and retries on transient failures.",
    "Gas balance is topped up by the keeper when below threshold.",
    "Execution traces are streamed to the audit log.",
    "Any revert is recorded with the contract error code.",
  ];
  return fragments.slice(0, sentenceCount).join(" ");
}

export function generateMockTasks(count: number, seed = 1): MockTask[] {
  const rand = mulberry32(seed);
  const tasks: MockTask[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const fn = FUNCTIONS[Math.floor(rand() * FUNCTIONS.length)];
    tasks[i] = {
      id: `task-${i.toString().padStart(6, "0")}`,
      title: `${fn} #${i}`,
      contract: pickContract(rand),
      fn,
      intervalSec: [60, 300, 900, 3600, 86400][Math.floor(rand() * 5)],
      gas: Math.round(rand() * 50 * 100) / 100,
      status: STATUSES[Math.floor(rand() * STATUSES.length)],
      description: pickDescription(rand, fn),
    };
  }
  return tasks;
}
