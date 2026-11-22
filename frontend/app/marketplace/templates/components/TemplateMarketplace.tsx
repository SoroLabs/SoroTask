"use client";

import React from "react";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import {
  COMMUNITY_TEMPLATES,
  DEFAULT_TEMPLATE_FILTERS,
  TEMPLATE_CATEGORIES,
  TRUST_TIERS,
  filterTemplates,
  sortTemplatesByPopularity,
  type TaskTemplate,
  type TemplateFilters,
  type TrustTier,
} from "@/src/lib/templates";

export interface TemplateMarketplaceProps {
  /** Overridable so the component can be driven by fetched data later. */
  templates?: readonly TaskTemplate[];
  onUseTemplate: (template: TaskTemplate) => void;
}

/**
 * Community template gallery (#1243).
 *
 * The existing `/marketplace` route is a keeper-bidding board, so task
 * templates live beside it under `/marketplace/templates` rather than
 * replacing it — the two audiences are different and both routes stay useful.
 */
export function TemplateMarketplace({
  templates = COMMUNITY_TEMPLATES,
  onUseTemplate,
}: TemplateMarketplaceProps) {
  const [filters, setFilters] = useState<TemplateFilters>(
    DEFAULT_TEMPLATE_FILTERS,
  );

  const visible = useMemo(
    () => sortTemplatesByPopularity(filterTemplates(templates, filters)),
    [templates, filters],
  );

  const setQuery = (query: string) => setFilters((f) => ({ ...f, query }));

  return (
    <section
      data-testid="template-marketplace"
      className="flex flex-col gap-6 p-6"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-neutral-100">
          Task Template Marketplace
        </h1>
        <p className="text-sm text-neutral-400">
          Start from a recipe someone has already run. Fork one, adjust the
          parameters, and deploy the whole flow as a single batched transaction.
        </p>
      </header>

      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
          />
          <label className="sr-only" htmlFor="template-search">
            Search templates
          </label>
          <input
            id="template-search"
            data-testid="template-search"
            type="search"
            value={filters.query}
            placeholder="Search templates"
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-2 pl-9 pr-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3">
          <div>
            <label className="sr-only" htmlFor="template-category">
              Category
            </label>
            <select
              id="template-category"
              data-testid="template-category"
              value={filters.category}
              onChange={(event) =>
                setFilters((f) => ({
                  ...f,
                  category: event.target.value as TemplateFilters["category"],
                }))
              }
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All categories</option>
              {TEMPLATE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="sr-only" htmlFor="template-trust">
              Trust tier
            </label>
            <select
              id="template-trust"
              data-testid="template-trust"
              value={filters.trustTier}
              onChange={(event) =>
                setFilters((f) => ({
                  ...f,
                  trustTier: event.target.value as TrustTier | "all",
                }))
              }
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All trust tiers</option>
              {TRUST_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Announced so the result count is not a purely visual change. */}
      <p
        aria-live="polite"
        data-testid="template-count"
        className="text-sm text-neutral-400"
      >
        {visible.length === 0
          ? "No templates match your filters."
          : `${visible.length} template${visible.length === 1 ? "" : "s"} available`}
      </p>

      {visible.length === 0 ? (
        <p
          data-testid="template-empty"
          className="rounded-lg border border-dashed border-neutral-700 p-8 text-center text-sm text-neutral-400"
        >
          Nothing here yet. Try a different search term or clear the filters.
        </p>
      ) : (
        <ul
          data-testid="template-grid"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visible.map((template) => (
            <li key={template.id}>
              <TemplateCard template={template} onUseTemplate={onUseTemplate} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default TemplateMarketplace;
