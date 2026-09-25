/**
 * Template schema, forking and gas estimation (#1243).
 */

import {
  COMMUNITY_TEMPLATES,
  DEFAULT_TEMPLATE_FILTERS,
  MAX_BATCH_OPERATIONS,
  MissingParameterError,
  canDeployWithoutInput,
  collectRequiredParameters,
  estimateTemplateGas,
  filterTemplates,
  forkTemplate,
  parseTemplate,
  parseTemplateJson,
  sortTemplatesByPopularity,
  toFlowTemplate,
  taskTemplateSchema,
  type TaskTemplate,
} from "@/src/lib/templates";

const VALID: TaskTemplate = {
  id: "test-template",
  name: "Test Template",
  description: "A template used by the test suite to exercise forking.",
  category: "defi",
  author: "tester",
  trustTier: "community",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tags: ["test"],
  intervalSeconds: 3600,
  timezone: "UTC",
  usageCount: 0,
  blocks: [
    {
      instanceId: "step-1",
      label: "Do The Thing",
      category: "defi",
      icon: "🌾",
      contractAddress:
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      functionName: "harvest",
      args: {},
      gasReserveXlm: 1.5,
      parameters: [
        {
          name: "pool_id",
          label: "Pool",
          type: "address",
          placeholder: "C…",
          defaultValue:
            "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          required: true,
        },
        {
          name: "min_amount",
          label: "Minimum",
          type: "i128",
          placeholder: "0",
          defaultValue: "0",
          required: false,
        },
      ],
    },
  ],
};

describe("parseTemplate", () => {
  it("accepts a well-formed template and applies defaults", () => {
    const input = {
      ...VALID,
      blocks: [{ ...VALID.blocks[0], parameters: undefined }],
    };
    delete (input.blocks[0] as Record<string, unknown>).parameters;

    const result = parseTemplate(input);
    expect(result.errors).toEqual([]);
    expect(result.template?.blocks[0].parameters).toEqual([]);
    expect(result.template?.blocks[0].gasReserveXlm).toBe(1.5);
  });

  it("rejects a non-`C` contract address rather than letting it reach the chain", () => {
    const result = parseTemplate({
      ...VALID,
      blocks: [{ ...VALID.blocks[0], contractAddress: "NOTACONTRACT" }],
    });
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/contract address/i);
  });

  it("rejects a camelCase function name", () => {
    const result = parseTemplate({
      ...VALID,
      blocks: [{ ...VALID.blocks[0], functionName: "doTheThing" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty block list", () => {
    expect(parseTemplate({ ...VALID, blocks: [] }).success).toBe(false);
  });

  it("rejects a non-positive interval", () => {
    expect(parseTemplate({ ...VALID, intervalSeconds: 0 }).success).toBe(false);
    expect(parseTemplate({ ...VALID, intervalSeconds: -1 }).success).toBe(
      false,
    );
  });

  it("rejects a parameter name that is not an identifier", () => {
    const result = parseTemplate({
      ...VALID,
      blocks: [
        {
          ...VALID.blocks[0],
          parameters: [{ name: "Bad Name", label: "x", type: "string" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("collects several field errors at once so a form can show them together", () => {
    const result = parseTemplate({ ...VALID, name: "x", intervalSeconds: -5 });
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("reports malformed JSON as an error instead of throwing", () => {
    const result = parseTemplateJson("{ not json");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Not valid JSON/);
  });

  it("round-trips a template through JSON", () => {
    const result = parseTemplateJson(JSON.stringify(VALID));
    expect(result.template?.id).toBe(VALID.id);
  });
});

describe("forkTemplate", () => {
  const fixedNow = () => new Date("2026-03-04T05:06:07.000Z");

  it("regenerates block instance ids so two forks cannot collide", () => {
    const a = forkTemplate(VALID, {}, fixedNow);
    const b = forkTemplate(VALID, {}, fixedNow);

    expect(a.template.blocks[0].instanceId).not.toBe(
      VALID.blocks[0].instanceId,
    );
    expect(a.template.blocks[0].instanceId).not.toBe(
      b.template.blocks[0].instanceId,
    );
  });

  it("records provenance", () => {
    const forked = forkTemplate(VALID, {}, fixedNow);
    expect(forked.forkedFrom).toBe("test-template");
    expect(forked.forkedAt).toBe("2026-03-04T05:06:07.000Z");
  });

  it("marks the copy as the user's own and downgrades its trust", () => {
    const forked = forkTemplate(VALID, {}, fixedNow);
    expect(forked.template.author).toBe("you");
    expect(forked.template.trustTier).toBe("experimental");
    expect(forked.template.usageCount).toBe(0);
    expect(forked.template.name).toContain("fork");
  });

  it("never mutates the source template", () => {
    const before = JSON.stringify(VALID);
    forkTemplate(VALID, { pool_id: "COTHER" }, fixedNow);
    expect(JSON.stringify(VALID)).toBe(before);
  });

  it("applies supplied overrides", () => {
    const forked = forkTemplate(VALID, { pool_id: "COVERRIDE" }, fixedNow);
    expect(forked.template.blocks[0].args.pool_id).toBe("COVERRIDE");
  });

  it("falls back to parameter defaults when nothing is supplied", () => {
    const forked = forkTemplate(VALID, {}, fixedNow);
    expect(forked.template.blocks[0].args.pool_id).toBe(
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(forked.template.blocks[0].args.min_amount).toBe("0");
  });

  it("throws a named error naming the step and parameter when input is missing", () => {
    const template: TaskTemplate = {
      ...VALID,
      blocks: [
        {
          ...VALID.blocks[0],
          parameters: [
            { name: "to", label: "To", type: "address", required: true },
          ],
        },
      ],
    };

    expect(() => forkTemplate(template, {}, fixedNow)).toThrow(
      MissingParameterError,
    );
    try {
      forkTemplate(template, {}, fixedNow);
    } catch (error) {
      expect((error as MissingParameterError).parameterName).toBe("to");
      expect((error as MissingParameterError).blockLabel).toBe("Do The Thing");
    }
  });

  it("omits an optional parameter that has neither input nor default", () => {
    const template: TaskTemplate = {
      ...VALID,
      blocks: [
        {
          ...VALID.blocks[0],
          parameters: [
            { name: "extra", label: "Extra", type: "string", required: false },
          ],
        },
      ],
    };
    const forked = forkTemplate(template, {}, fixedNow);
    expect(forked.template.blocks[0].args.extra).toBeUndefined();
  });

  it("produces a schema-valid template", () => {
    const forked = forkTemplate(VALID, {}, fixedNow);
    expect(taskTemplateSchema.safeParse(forked.template).success).toBe(true);
  });
});

describe("required parameters", () => {
  it("flattens required parameters across steps", () => {
    const names = collectRequiredParameters(VALID).map((p) => p.name);
    expect(names).toEqual(["pool_id"]);
  });

  it("reports a template deployable with no input when defaults cover everything", () => {
    expect(canDeployWithoutInput(VALID)).toBe(true);
  });

  it("reports a template needing input when a required parameter has no default", () => {
    const template: TaskTemplate = {
      ...VALID,
      blocks: [
        {
          ...VALID.blocks[0],
          parameters: [
            { name: "to", label: "To", type: "address", required: true },
          ],
        },
      ],
    };
    expect(canDeployWithoutInput(template)).toBe(false);
  });
});

describe("estimateTemplateGas", () => {
  it("separates the up-front fee from the ongoing reserve", () => {
    const estimate = estimateTemplateGas(VALID);
    expect(estimate.operationCount).toBe(1);
    expect(estimate.feeStroops).toBe(100);
    expect(estimate.feeXlm).toBeGreaterThan(0);
    expect(estimate.reserveXlm).toBeGreaterThanOrEqual(1.5);
    expect(estimate.totalXlm).toBeCloseTo(
      estimate.reserveXlm + estimate.feeXlm,
      10,
    );
  });

  it("sums the reserve across every step", () => {
    const twoStep: TaskTemplate = {
      ...VALID,
      blocks: [
        { ...VALID.blocks[0], gasReserveXlm: 2 },
        { ...VALID.blocks[0], instanceId: "step-2", gasReserveXlm: 3 },
      ],
    };
    expect(estimateTemplateGas(twoStep).reserveXlm).toBe(5);
  });

  it("floors a zero reserve so a step is never unfunded", () => {
    const zeroed: TaskTemplate = {
      ...VALID,
      blocks: [{ ...VALID.blocks[0], gasReserveXlm: 0 }],
    };
    expect(estimateTemplateGas(zeroed).reserveXlm).toBeGreaterThan(0);
  });

  it("warns and clamps when the template exceeds the batch limit", () => {
    const many: TaskTemplate = {
      ...VALID,
      blocks: Array.from({ length: MAX_BATCH_OPERATIONS + 5 }, (_, i) => ({
        ...VALID.blocks[0],
        instanceId: `step-${i}`,
      })),
    };

    const estimate = estimateTemplateGas(many);
    expect(estimate.singleTransaction).toBe(false);
    expect(estimate.operationCount).toBe(MAX_BATCH_OPERATIONS);
    expect(estimate.warning).toMatch(/separately/);
  });

  it("gives no warning at exactly the limit", () => {
    const exact: TaskTemplate = {
      ...VALID,
      blocks: Array.from({ length: MAX_BATCH_OPERATIONS }, (_, i) => ({
        ...VALID.blocks[0],
        instanceId: `step-${i}`,
      })),
    };
    const estimate = estimateTemplateGas(exact);
    expect(estimate.singleTransaction).toBe(true);
    expect(estimate.warning).toBeNull();
  });
});

describe("toFlowTemplate", () => {
  it("produces a shape the existing task builder accepts", () => {
    const flow = toFlowTemplate(VALID);
    expect(flow.name).toBe(VALID.name);
    expect(flow.createdAt).toBeInstanceOf(Date);
    expect(flow.blocks).toHaveLength(1);
    expect(flow.blocks[0].functionName).toBe("harvest");
    expect(flow.blocks[0].isConfigured).toBe(true);
  });

  it("maps declared parameter types onto builder inputs", () => {
    const flow = toFlowTemplate(VALID);
    expect(flow.blocks[0].inputs).toEqual([
      { name: "pool_id", type: "address", optional: false },
      { name: "min_amount", type: "i128", optional: true },
    ]);
  });

  it("copies resolved args", () => {
    const forked = forkTemplate(
      VALID,
      {},
      () => new Date("2026-03-04T05:06:07.000Z"),
    );
    const flow = toFlowTemplate(forked.template);
    expect(flow.blocks[0].args.pool_id).toBeDefined();
  });
});

describe("curated templates", () => {
  it("all satisfy the schema", () => {
    for (const template of COMMUNITY_TEMPLATES) {
      const result = parseTemplate(template);
      expect({ id: template.id, errors: result.errors }).toEqual({
        id: template.id,
        errors: [],
      });
    }
  });

  it("include the two recipes named in the acceptance criteria", () => {
    const ids = COMMUNITY_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("yield-harvest-daily");
    expect(ids).toContain("balance-sweep");
  });

  it("have unique ids", () => {
    const ids = COMMUNITY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keep every step below the batch limit", () => {
    for (const template of COMMUNITY_TEMPLATES) {
      expect(estimateTemplateGas(template).singleTransaction).toBe(true);
    }
  });
});

describe("filtering and sorting", () => {
  it("returns everything with default filters", () => {
    expect(
      filterTemplates(COMMUNITY_TEMPLATES, DEFAULT_TEMPLATE_FILTERS),
    ).toHaveLength(COMMUNITY_TEMPLATES.length);
  });

  it("matches the query against name, description and tags", () => {
    const byName = filterTemplates(COMMUNITY_TEMPLATES, {
      ...DEFAULT_TEMPLATE_FILTERS,
      query: "yield harvest",
    });
    expect(byName.map((t) => t.id)).toContain("yield-harvest-daily");

    const byTag = filterTemplates(COMMUNITY_TEMPLATES, {
      ...DEFAULT_TEMPLATE_FILTERS,
      query: "governance",
    });
    expect(byTag.map((t) => t.id)).toContain("governance-vote");
  });

  it("is case-insensitive", () => {
    const results = filterTemplates(COMMUNITY_TEMPLATES, {
      ...DEFAULT_TEMPLATE_FILTERS,
      query: "SWEEP",
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by category and trust tier", () => {
    expect(
      filterTemplates(COMMUNITY_TEMPLATES, {
        ...DEFAULT_TEMPLATE_FILTERS,
        category: "governance",
      }).map((t) => t.id),
    ).toEqual(["governance-vote"]);

    // `filterTemplates` preserves source order; ranking is `sortTemplatesByPopularity`'s
    // job, and keeping the two separate means a caller can choose either.
    expect(
      filterTemplates(COMMUNITY_TEMPLATES, {
        ...DEFAULT_TEMPLATE_FILTERS,
        trustTier: "verified",
      }).map((t) => t.id),
    ).toEqual(["yield-harvest-daily", "balance-sweep"]);
  });

  it("combines filters conjunctively", () => {
    const results = filterTemplates(COMMUNITY_TEMPLATES, {
      query: "swap",
      category: "defi",
      trustTier: "verified",
    });
    expect(results).toEqual([]);
  });

  it("returns an empty list rather than throwing when nothing matches", () => {
    expect(
      filterTemplates(COMMUNITY_TEMPLATES, {
        ...DEFAULT_TEMPLATE_FILTERS,
        query: "zzzz",
      }),
    ).toEqual([]);
  });

  it("sorts by usage, breaking ties by name", () => {
    const sorted = sortTemplatesByPopularity(COMMUNITY_TEMPLATES);
    expect(sorted[0].id).toBe("balance-sweep");
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].usageCount).toBeGreaterThanOrEqual(
        sorted[i].usageCount,
      );
    }
  });

  it("does not mutate the input when sorting", () => {
    const original = COMMUNITY_TEMPLATES.map((t) => t.id);
    sortTemplatesByPopularity(COMMUNITY_TEMPLATES);
    expect(COMMUNITY_TEMPLATES.map((t) => t.id)).toEqual(original);
  });
});
