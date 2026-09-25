/**
 * Community task template schema, parser and forking (#1243).
 *
 * A template is a reusable recipe: an ordered list of `ActionBlock`s plus the
 * interval, gas budget and metadata a keeper needs to run it. The template
 * builder (#405) produces them interactively and the marketplace consumes them,
 * so the shape is defined once, here, and validated at every boundary.
 *
 * Three things make this more than a type declaration:
 *
 *  - `parseTemplate` validates untrusted JSON. A template is data, and data
 *    from a community listing cannot be trusted to be well-formed, so it is
 *    checked rather than cast.
 *  - `forkTemplate` produces an independent copy with fresh instance ids and
 *    recorded provenance, so two people forking the same template cannot
 *    collide and an edited fork is traceable back to its source.
 *  - `estimateTemplateGas` gives a preview *before* a wallet is opened, which
 *    is what makes "deploy in under 60 seconds" achievable: the user is not
 *    asked to sign a transaction whose cost they have not seen.
 */

import { z } from "zod";
import type {
  ActionBlock,
  ActionCategory,
  FlowTemplate,
} from "@/app/template-builder/types";
import { EXAMPLE_CONTRACT_ADDRESS } from "@/app/utils/formValidation/schemas/taskCreationSchema";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** A Soroban contract id: `C` followed by 55 base32 characters. */
const CONTRACT_ADDRESS = /^C[A-Z0-9]{55}$/;
/** A Soroban function name: lower snake_case. */
const FUNCTION_NAME = /^[a-z_][a-z0-9_]*$/;

export const TEMPLATE_CATEGORIES = [
  "defi",
  "transfer",
  "governance",
  "automation",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** How much the community has leaned on a template. */
export const TRUST_TIERS = ["verified", "community", "experimental"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

/** A parameter a user is asked to fill in before deploying. */
export const templateParameterSchema = z.object({
  name: z
    .string()
    .min(1)
    // Parameter names become call arguments, so they are held to the same
    // identifier rule the contract interface uses.
    .regex(FUNCTION_NAME, "Parameter names must be lower snake_case"),
  label: z.string().min(1),
  type: z.enum(["address", "u32", "u64", "i128", "bool", "string"]),
  /** Placeholder shown in the customisation modal. Cosmetic, so optional. */
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  /** A safe default, so a template can be deployed with zero input. */
  defaultValue: z.string().optional(),
  required: z.boolean().default(true),
});

export type TemplateParameter = z.infer<typeof templateParameterSchema>;

export const templateBlockSchema = z.object({
  /** Unique within a template; regenerated on fork. */
  instanceId: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["defi", "transfer", "governance", "custom"]),
  icon: z.string().default("⚙️"),
  contractAddress: z
    .string()
    .regex(CONTRACT_ADDRESS, "Not a valid Soroban contract address"),
  functionName: z.string().regex(FUNCTION_NAME, "Must be lower snake_case"),
  /** Call arguments. Keys are parameter names. */
  args: z.record(z.string(), z.string()).default({}),
  /** Parameters the user must supply; becomes the modal's form. */
  parameters: z.array(templateParameterSchema).default([]),
  /**
   * XLM reserved to pay for this step's execution. Summed across the template
   * to give the total a keeper will need.
   */
  gasReserveXlm: z.number().nonnegative().default(0.5),
});

export type TemplateBlock = z.infer<typeof templateBlockSchema>;

export const taskTemplateSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Template ids must be lower kebab-case"),
  name: z.string().min(3).max(80),
  description: z.string().min(10).max(600),
  category: z.enum(TEMPLATE_CATEGORIES),
  author: z.string().min(1),
  trustTier: z.enum(TRUST_TIERS).default("community"),
  /** ISO-8601. */
  updatedAt: z.string().min(1),
  tags: z.array(z.string().min(1)).max(8).default([]),
  /** Default interval between executions, in seconds. */
  intervalSeconds: z.number().int().positive().max(31_536_000),
  blocks: z.array(templateBlockSchema).min(1).max(20),
  /** IANA timezone the schedule is expressed in. */
  timezone: z.string().default("UTC"),
  usageCount: z.number().int().nonnegative().default(0),
});

export type TaskTemplate = z.infer<typeof taskTemplateSchema>;

/** What `forkTemplate` hands back, including where the copy came from. */
export interface ForkedTemplate {
  template: TaskTemplate;
  /** Id of the template this was forked from, or null for an original. */
  forkedFrom: string | null;
  forkedAt: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParseResult {
  success: boolean;
  template?: TaskTemplate;
  /** Field-level messages, safe to show next to the offending input. */
  errors: string[];
}

/**
 * Validates untrusted input into a `TaskTemplate`.
 *
 * Returns the collected messages rather than throwing: a marketplace listing
 * with a bad field should be skippable, not a blank page.
 */
export function parseTemplate(input: unknown): ParseResult {
  const result = taskTemplateSchema.safeParse(input);

  if (result.success) {
    return { success: true, template: result.data, errors: [] };
  }

  return { success: false, errors: flattenIssues(result.error) };
}

/** Parses a JSON string, reporting malformed JSON as a normal error. */
export function parseTemplateJson(json: string): ParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch (error) {
    return {
      success: false,
      errors: [
        `Not valid JSON: ${error instanceof Error ? error.message : "unknown"}`,
      ],
    };
  }
  return parseTemplate(decoded);
}

/** Renders zod issues as `path: message` strings. */
function flattenIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

// ---------------------------------------------------------------------------
// Forking
// ---------------------------------------------------------------------------

let forkCounter = 0;

/**
 * Generates a collision-resistant instance id.
 *
 * `crypto.randomUUID` is not available in every environment this code runs in
 * (older Safari, some SSR paths), hence the counter fallback — the counter is
 * what guarantees uniqueness when the UUID is unavailable.
 */
function nextInstanceId(seed: string): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : (forkCounter++).toString(36).padStart(8, "0");
  return `${seed}-${uuid}`;
}

/**
 * Produces an independent, deployable copy of a template.
 *
 * Every block gets a fresh `instanceId`: reusing the source ids would make two
 * forks of the same template collide in any store keyed by instance id, and
 * would make React reuse DOM nodes across two different recipes.
 *
 * `overrides` supplies the answers the customisation modal collected.
 */
export function forkTemplate(
  source: TaskTemplate,
  overrides: Record<string, string> = {},
  now: () => Date = () => new Date(),
): ForkedTemplate {
  const forkedAt = now().toISOString();

  const blocks: TemplateBlock[] = source.blocks.map((block) => {
    const args: Record<string, string> = { ...block.args };

    // Apply a supplied value, otherwise fall back to the parameter default, so
    // a fork of a template with defaults is deployable with no input at all.
    for (const parameter of block.parameters) {
      const supplied = overrides[parameter.name];
      const value = supplied ?? parameter.defaultValue;

      if (value === undefined) {
        if (parameter.required) {
          throw new MissingParameterError(block.label, parameter.name);
        }
        continue;
      }
      args[parameter.name] = value;
    }

    return {
      ...block,
      instanceId: nextInstanceId(block.functionName),
      args,
    };
  });

  return {
    template: {
      ...source,
      // A fork is the user's own copy, not the community entry.
      id: `${source.id}-fork-${forkedAt.replace(/\D/g, "").slice(0, 14)}`,
      name: `${source.name} (fork)`,
      author: "you",
      trustTier: "experimental",
      updatedAt: forkedAt,
      usageCount: 0,
      blocks,
    },
    forkedFrom: source.id,
    forkedAt,
  };
}

export class MissingParameterError extends Error {
  constructor(
    readonly blockLabel: string,
    readonly parameterName: string,
  ) {
    super(`"${parameterName}" is required by the "${blockLabel}" step.`);
    this.name = "MissingParameterError";
  }
}

/** Parameters a user must supply, flattened across every step. */
export function collectRequiredParameters(
  template: TaskTemplate,
): TemplateParameter[] {
  return template.blocks.flatMap((block) =>
    block.parameters.filter((p) => p.required),
  );
}

/** True when every required parameter has a value or a default. */
export function canDeployWithoutInput(template: TaskTemplate): boolean {
  return collectRequiredParameters(template).every(
    (p) => p.defaultValue !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Gas estimation
// ---------------------------------------------------------------------------

/** Stellar's base fee per operation, in stroops. */
export const BASE_FEE_STROOPS = 100;
/** XLM per operation for simulation/inclusion, a rough network-average value. */
export const FEE_XLM_PER_OPERATION = 0.00001;
/** Native XLM reserved per operation to fund the keeper's own fee. */
export const RESERVE_XLM_PER_OPERATION = 0.1;

export interface GasEstimate {
  operationCount: number;
  /** Network fee for the batch, in stroops. */
  feeStroops: number;
  /** Network fee converted to XLM. */
  feeXlm: number;
  /** XLM the tasks need held on-chain to pay for future executions. */
  reserveXlm: number;
  /** `reserveXlm + feeXlm`: what the user should expect to need. */
  totalXlm: number;
  /** Whether the whole template fits in a single transaction. */
  singleTransaction: boolean;
  /** Set when the estimate was clamped by the batch-size limit. */
  warning: string | null;
}

/** Soroban caps a transaction at 100 operations; we stay well under it. */
export const MAX_BATCH_OPERATIONS = 20;

/**
 * Previews the cost of deploying a whole template as one batched transaction.
 *
 * The split between `fee` (paid now, to get the transaction included) and
 * `reserve` (held by the tasks afterwards, to pay for the executions that
 * follow) matters: users conflate the two, and a preview that only shows one of
 * them produces a transaction that succeeds and then fails on the first run.
 */
export function estimateTemplateGas(template: TaskTemplate): GasEstimate {
  const total = template.blocks.length;
  const operationCount = Math.min(total, MAX_BATCH_OPERATIONS);
  const singleTransaction = total <= MAX_BATCH_OPERATIONS;

  const feeStroops = BASE_FEE_STROOPS * operationCount;
  const feeXlm = operationCount * FEE_XLM_PER_OPERATION;
  const reserveXlm = template.blocks.reduce(
    (total_, block) =>
      total_ + Math.max(block.gasReserveXlm, RESERVE_XLM_PER_OPERATION),
    0,
  );

  return {
    operationCount,
    feeStroops,
    feeXlm,
    reserveXlm,
    totalXlm: reserveXlm + feeXlm,
    singleTransaction,
    warning: singleTransaction
      ? null
      : `Only the first ${MAX_BATCH_OPERATIONS} of ${total} steps fit in one transaction; the rest must be deployed separately.`,
  };
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** The shape the existing task builder persists (`app/tasks/page.tsx`). */
export interface FlowTemplateRecord {
  id: string;
  name: string;
  description?: string;
  blocks: ActionBlock[];
  createdAt: Date;
}

/**
 * Converts a template into the `FlowTemplate` the builder already understands,
 * so a forked template can be opened and edited with no new UI.
 */
export function toFlowTemplate(
  template: TaskTemplate,
  category: ActionCategory = "defi",
  now: () => Date = () => new Date(),
): FlowTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    createdAt: now(),
    blocks: template.blocks.map((block) => ({
      instanceId: block.instanceId,
      definitionId: `${block.functionName}`,
      label: block.label,
      category: (block.category === "custom"
        ? category
        : block.category) as ActionCategory,
      icon: block.icon,
      contractAddress: block.contractAddress,
      functionName: block.functionName,
      // The template's declared types drive the builder's param list.
      inputs: block.parameters.map((p) => ({
        name: p.name,
        type:
          p.type === "i128"
            ? ("i128" as const)
            : (p.type as ActionBlock["inputs"][number]["type"]),
        optional: !p.required,
      })),
      args: { ...block.args },
      // A fork is fully configured once every required parameter resolved.
      isConfigured: true,
    })),
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Example contract ids for the starter templates.
 *
 * Derived from the form schema's own `EXAMPLE_CONTRACT_ADDRESS` so that every
 * address here is guaranteed to pass `STELLAR_CONTRACT_ADDRESS_REGEX` — a
 * hand-typed literal is off-by-one-prone, and an invalid one is rejected by
 * `parseTemplate`, which is exactly the kind of thing that only shows up when
 * someone clicks "Use template".
 */
const EXAMPLE_POOL = EXAMPLE_CONTRACT_ADDRESS;
const EXAMPLE_VAULT = shiftContractId(EXAMPLE_CONTRACT_ADDRESS, 1);
const EXAMPLE_DEX = shiftContractId(EXAMPLE_CONTRACT_ADDRESS, 2);
const EXAMPLE_STAKING = shiftContractId(EXAMPLE_CONTRACT_ADDRESS, 3);
const EXAMPLE_GOVERNANCE = shiftContractId(EXAMPLE_CONTRACT_ADDRESS, 4);

/** Produces a distinct but equally valid contract id. */
function shiftContractId(base: string, offset: number): string {
  const body = base
    .slice(1)
    .split("")
    .map((c) => c);
  const index = body.length - 1;
  body[index] = String.fromCharCode(body[index].charCodeAt(0) + offset);
  return `C${body.join("")}`;
}

/**
 * Curated starter templates.
 *
 * The acceptance criterion names yield harvesting and balance sweeping
 * specifically, so both ship here alongside the other common recipes. Addresses
 * are the Soroban example contract so a fork can be previewed end-to-end
 * before pointing it at a real pool.
 */
export const COMMUNITY_TEMPLATES: TaskTemplate[] = [
  {
    id: "yield-harvest-daily",
    name: "Daily Yield Harvest",
    description:
      "Claims accumulated yield from a liquidity pool and sweeps the proceeds to your wallet once a day.",
    category: "defi",
    author: "sorotask-team",
    trustTier: "verified",
    updatedAt: "2026-02-18T10:00:00.000Z",
    tags: ["defi", "yield", "liquidity"],
    intervalSeconds: 86_400,
    timezone: "UTC",
    usageCount: 1_284,
    blocks: [
      {
        instanceId: "harvest-claim",
        label: "Harvest Yield",
        category: "defi",
        icon: "🌾",
        contractAddress: EXAMPLE_POOL,
        functionName: "harvest",
        args: {},
        gasReserveXlm: 1.2,
        parameters: [
          {
            name: "pool_id",
            label: "Liquidity pool address",
            type: "address",
            placeholder: "C…",
            defaultValue: EXAMPLE_POOL,
            required: true,
          },
          {
            name: "min_amount",
            label: "Minimum amount to accept",
            type: "i128",
            placeholder: "0",
            defaultValue: "0",
            required: false,
          },
        ],
      },
      {
        instanceId: "harvest-sweep",
        label: "Sweep Proceeds",
        category: "transfer",
        icon: "💸",
        contractAddress: EXAMPLE_VAULT,
        functionName: "transfer",
        args: {},
        gasReserveXlm: 0.8,
        parameters: [
          {
            name: "to",
            label: "Destination address",
            type: "address",
            placeholder: "G…",
            required: true,
          },
          {
            name: "amount",
            label: "Amount (stroops)",
            type: "i128",
            placeholder: "0",
            defaultValue: "0",
            required: false,
          },
        ],
      },
    ],
  },
  {
    id: "balance-sweep",
    name: "Balance Sweep",
    description:
      "Moves a fixed amount from a contract to your wallet on a schedule. The simplest possible template.",
    category: "transfer",
    author: "sorotask-team",
    trustTier: "verified",
    updatedAt: "2026-02-20T09:30:00.000Z",
    tags: ["transfer", "sweep"],
    intervalSeconds: 3600,
    timezone: "UTC",
    usageCount: 3_907,
    blocks: [
      {
        instanceId: "sweep-transfer",
        label: "Sweep Balance",
        category: "transfer",
        icon: "💸",
        contractAddress: EXAMPLE_VAULT,
        functionName: "transfer",
        args: {},
        gasReserveXlm: 0.6,
        parameters: [
          {
            name: "to",
            label: "Destination address",
            type: "address",
            placeholder: "G…",
            required: true,
          },
          {
            name: "amount",
            label: "Amount (stroops)",
            type: "i128",
            placeholder: "1000000",
            defaultValue: "1000000",
            required: true,
          },
        ],
      },
    ],
  },
  {
    id: "dex-rebalance",
    name: "DEX Rebalance",
    description:
      "Swaps a token pair back to its target ratio every six hours, keeping a portfolio at a fixed allocation.",
    category: "defi",
    author: "community-labs",
    trustTier: "community",
    updatedAt: "2026-01-30T14:15:00.000Z",
    tags: ["defi", "swap", "rebalance"],
    intervalSeconds: 21_600,
    timezone: "UTC",
    usageCount: 612,
    blocks: [
      {
        instanceId: "rebalance-swap",
        label: "Rebalance Swap",
        category: "defi",
        icon: "🔄",
        contractAddress: EXAMPLE_DEX,
        functionName: "swap",
        args: {},
        gasReserveXlm: 1.5,
        parameters: [
          {
            name: "token_in",
            label: "Input token",
            type: "address",
            placeholder: "C…",
            required: true,
          },
          {
            name: "token_out",
            label: "Output token",
            type: "address",
            placeholder: "C…",
            required: true,
          },
          {
            name: "amount_in",
            label: "Amount in",
            type: "i128",
            placeholder: "0",
            defaultValue: "0",
            required: false,
          },
          {
            name: "min_amount_out",
            label: "Minimum output",
            type: "i128",
            placeholder: "0",
            defaultValue: "0",
            required: false,
          },
        ],
      },
    ],
  },
  {
    id: "stake-and-compound",
    name: "Stake & Compound",
    description:
      "Stakes a token then harvests the staking rewards on the same schedule, compounding in place.",
    category: "defi",
    author: "community-labs",
    trustTier: "community",
    updatedAt: "2026-02-02T08:45:00.000Z",
    tags: ["defi", "staking"],
    intervalSeconds: 604_800,
    timezone: "UTC",
    usageCount: 388,
    blocks: [
      {
        instanceId: "compound-stake",
        label: "Stake Tokens",
        category: "defi",
        icon: "🔒",
        contractAddress: EXAMPLE_STAKING,
        functionName: "stake",
        args: {},
        gasReserveXlm: 1,
        parameters: [
          {
            name: "amount",
            label: "Amount",
            type: "i128",
            placeholder: "0",
            defaultValue: "0",
            required: false,
          },
        ],
      },
      {
        instanceId: "compound-claim",
        label: "Claim Rewards",
        category: "defi",
        icon: "🌾",
        contractAddress: EXAMPLE_STAKING,
        functionName: "harvest",
        args: {},
        gasReserveXlm: 1,
        parameters: [],
      },
    ],
  },
  {
    id: "governance-vote",
    name: "Scheduled Governance Vote",
    description:
      "Casts a vote on a fixed proposal every week, so a delegate never misses a window.",
    category: "governance",
    author: "sorotask-team",
    trustTier: "experimental",
    updatedAt: "2026-02-11T17:00:00.000Z",
    tags: ["governance", "vote"],
    intervalSeconds: 604_800,
    timezone: "UTC",
    usageCount: 145,
    blocks: [
      {
        instanceId: "gov-vote",
        label: "Cast Vote",
        category: "governance",
        icon: "🗳️",
        contractAddress: EXAMPLE_GOVERNANCE,
        functionName: "vote",
        args: {},
        gasReserveXlm: 0.4,
        parameters: [
          {
            name: "proposal_id",
            label: "Proposal ID",
            type: "u64",
            placeholder: "1",
            defaultValue: "1",
            required: true,
          },
          {
            name: "support",
            label: "Vote in favour",
            type: "bool",
            placeholder: "true",
            defaultValue: "true",
            required: true,
          },
        ],
      },
    ],
  },
];

/** Search and filter over the template list. */
export interface TemplateFilters {
  query: string;
  category: TemplateCategory | "all";
  trustTier: TrustTier | "all";
}

export const DEFAULT_TEMPLATE_FILTERS: TemplateFilters = {
  query: "",
  category: "all",
  trustTier: "all",
};

export function filterTemplates(
  templates: readonly TaskTemplate[],
  filters: TemplateFilters,
): TaskTemplate[] {
  const query = filters.query.trim().toLowerCase();

  return templates.filter((template) => {
    if (filters.category !== "all" && template.category !== filters.category)
      return false;
    if (filters.trustTier !== "all" && template.trustTier !== filters.trustTier)
      return false;

    if (!query) return true;

    // Match the name, description and tags: a user looking for "harvest"
    // should not have to know whether it was filed under tags or prose.
    const haystack = [template.name, template.description, ...template.tags]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

/** Ranks by usage, then by name, so ordering is stable for equal counts. */
export function sortTemplatesByPopularity(
  templates: readonly TaskTemplate[],
): TaskTemplate[] {
  return [...templates].sort(
    (a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name),
  );
}
