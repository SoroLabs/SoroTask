"use client";

import React from "react";
import { ShieldCheck, Users, Zap } from "lucide-react";
import {
  canDeployWithoutInput,
  estimateTemplateGas,
  type TaskTemplate,
  type TrustTier,
} from "@/src/lib/templates";

export interface TemplateCardProps {
  template: TaskTemplate;
  onUseTemplate: (template: TaskTemplate) => void;
}

const TRUST_STYLES: Record<
  TrustTier,
  { badge: string; icon: typeof ShieldCheck; label: string }
> = {
  verified: {
    badge: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
    icon: ShieldCheck,
    label: "Verified",
  },
  community: {
    badge: "bg-blue-500/10 border-blue-500/30 text-blue-200",
    icon: Users,
    label: "Community",
  },
  experimental: {
    badge: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    icon: Zap,
    label: "Experimental",
  },
};

/** Renders an interval as the largest sensible unit. */
function formatInterval(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "daily" : `every ${days} days`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return hours === 1 ? "hourly" : `every ${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
  }
  return `every ${seconds}s`;
}

export function TemplateCard({ template, onUseTemplate }: TemplateCardProps) {
  const trust = TRUST_STYLES[template.trustTier];
  const TrustIcon = trust.icon;
  const estimate = estimateTemplateGas(template);
  const zeroConfig = canDeployWithoutInput(template);
  const stepCount = template.blocks.length;

  return (
    <article
      data-testid={`template-card-${template.id}`}
      aria-label={template.name}
      className="flex h-full flex-col gap-4 rounded-xl border border-neutral-700/60 bg-neutral-900 p-5 transition-shadow hover:border-neutral-600 hover:shadow-lg"
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-neutral-100">
          {template.name}
        </h2>
        <span
          data-testid={`template-trust-${template.id}`}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${trust.badge}`}
        >
          <TrustIcon aria-hidden className="h-3 w-3" />
          {trust.label}
        </span>
      </header>

      <p className="text-sm text-neutral-400">{template.description}</p>

      <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-400">
        <div>
          <dt className="text-neutral-500">Runs</dt>
          <dd className="text-neutral-200">
            {formatInterval(template.intervalSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Steps</dt>
          <dd className="text-neutral-200">
            {stepCount} {stepCount === 1 ? "step" : "steps"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Est. cost</dt>
          <dd className="text-neutral-200">
            {estimate.totalXlm.toFixed(4)} XLM
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Deploys in</dt>
          <dd className="text-neutral-200">
            {estimate.singleTransaction ? "1 transaction" : "multiple"}
          </dd>
        </div>
      </dl>

      {template.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {template.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-neutral-500">
        {zeroConfig
          ? "No configuration needed — deploy as-is."
          : "Requires a few details before deploying."}
      </p>

      <div className="mt-auto">
        <button
          type="button"
          onClick={() => onUseTemplate(template)}
          data-testid={`use-template-${template.id}`}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Use template
        </button>
      </div>
    </article>
  );
}

export default TemplateCard;
