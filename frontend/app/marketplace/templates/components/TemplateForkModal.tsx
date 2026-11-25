"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import {
  collectRequiredParameters,
  estimateTemplateGas,
  forkTemplate,
  toFlowTemplate,
  type ForkedTemplate,
  type TaskTemplate,
  type TemplateParameter,
} from "@/src/lib/templates";

export interface TemplateForkModalProps {
  template: TaskTemplate;
  onClose: () => void;
  /**
   * Performs the deployment. Injected rather than imported so the modal owns no
   * wallet or RPC concerns and the whole flow is testable without a chain.
   * Receives the forked template and the batch the deploy will submit.
   */
  onDeploy: (
    forked: ForkedTemplate,
    batch: ReturnType<typeof toFlowTemplate>,
  ) => Promise<void>;
}

export function TemplateForkModal({
  template,
  onClose,
  onDeploy,
}: TemplateForkModalProps) {
  // Seed from the declared defaults so a fully-defaulted template opens ready
  // to deploy, which is most of what "under 60 seconds" means in practice.
  const required = useMemo(
    () => collectRequiredParameters(template),
    [template],
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(required.map((p) => [p.name, p.defaultValue ?? ""])),
  );
  const [status, setStatus] = useState<
    "idle" | "deploying" | "deployed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // Escape to dismiss, matching the rest of the dialogs in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "deploying") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, status]);

  const estimate = useMemo(() => estimateTemplateGas(template), [template]);

  const missing = required.filter((p) => !values[p.name]?.trim());
  const canDeploy = missing.length === 0 && status !== "deploying";

  const setValue = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const deploy = async () => {
    if (!canDeploy) return;

    setStatus("deploying");
    setError(null);

    try {
      // Fork before touching the wallet: a failure here is a plain validation
      // error the user can correct, and must not have cost a signature.
      const forked = forkTemplate(template, values);
      const batch = toFlowTemplate(forked.template);
      await onDeploy(forked, batch);
      setStatus("deployed");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Deployment failed");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-modal-title"
      data-testid="template-fork-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="fork-modal-title"
              className="text-lg font-semibold text-neutral-100"
            >
              {template.name}
            </h2>
            <p className="text-sm text-neutral-400">
              Forking from{" "}
              <span className="text-neutral-200">{template.author}</span>.
              Nothing is sent on-chain until you confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === "deploying"}
            aria-label="Close"
            data-testid="fork-modal-close"
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        {/* ── Steps ─────────────────────────────────────────────────── */}
        <section aria-labelledby="fork-steps-heading">
          <h3
            id="fork-steps-heading"
            className="mb-2 text-sm font-semibold text-neutral-200"
          >
            What this template runs
          </h3>
          <ol data-testid="fork-steps" className="flex flex-col gap-2">
            {template.blocks.map((block) => (
              <li
                key={block.instanceId}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 text-neutral-200">
                  <span aria-hidden>{block.icon}</span>
                  {block.label}
                  <code className="font-mono text-xs text-neutral-500">
                    {block.functionName}()
                  </code>
                </span>
                <span className="shrink-0 font-mono text-xs text-neutral-500">
                  {block.contractAddress.slice(0, 6)}…
                  {block.contractAddress.slice(-4)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Parameters ────────────────────────────────────────────── */}
        {required.length > 0 && (
          <section aria-labelledby="fork-params-heading">
            <h3
              id="fork-params-heading"
              className="mb-2 text-sm font-semibold text-neutral-200"
            >
              Details to fill in
            </h3>
            <div className="flex flex-col gap-3">
              {required.map((parameter: TemplateParameter) => {
                const fieldId = `param-${parameter.name}`;
                const isMissing = !values[parameter.name]?.trim();
                return (
                  <div key={parameter.name} className="flex flex-col gap-1">
                    <label
                      htmlFor={fieldId}
                      className="text-sm text-neutral-300"
                    >
                      {parameter.label}
                    </label>
                    <input
                      id={fieldId}
                      name={parameter.name}
                      data-testid={`fork-input-${parameter.name}`}
                      value={values[parameter.name] ?? ""}
                      placeholder={parameter.placeholder}
                      onChange={(event) =>
                        setValue(parameter.name, event.target.value)
                      }
                      aria-invalid={isMissing}
                      className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 aria-invalid:border-red-500"
                    />
                    {isMissing && (
                      <span className="text-xs text-red-300">
                        Required before deploying.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Gas preview ───────────────────────────────────────────── */}
        <section
          aria-labelledby="fork-gas-heading"
          data-testid="fork-gas-preview"
          className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-4"
        >
          <h3
            id="fork-gas-heading"
            className="mb-3 text-sm font-semibold text-neutral-200"
          >
            Cost preview
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-neutral-500">Operations</dt>
              <dd className="text-neutral-100">{estimate.operationCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Network fee</dt>
              <dd className="text-neutral-100">
                {estimate.feeXlm.toFixed(5)} XLM
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Held for runs</dt>
              <dd className="text-neutral-100">
                {estimate.reserveXlm.toFixed(2)} XLM
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Total</dt>
              <dd
                data-testid="fork-gas-total"
                className="font-semibold text-neutral-100"
              >
                {estimate.totalXlm.toFixed(4)} XLM
              </dd>
            </div>
          </dl>
          {estimate.warning && (
            <p className="mt-3 flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle
                aria-hidden
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              {estimate.warning}
            </p>
          )}
        </section>

        {error && (
          <p
            role="alert"
            data-testid="fork-error"
            className="text-sm text-red-300"
          >
            {error}
          </p>
        )}

        {status === "deployed" && (
          <p
            data-testid="fork-success"
            className="flex items-center gap-2 text-sm text-emerald-300"
          >
            <Check aria-hidden className="h-4 w-4" />
            Deployed. Your tasks are now live.
          </p>
        )}

        <footer className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={status === "deploying"}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={deploy}
            disabled={!canDeploy}
            data-testid="fork-deploy"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "deploying" && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            {status === "deploying"
              ? "Deploying…"
              : `Deploy ${estimate.operationCount} ${estimate.operationCount === 1 ? "task" : "tasks"}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default TemplateForkModal;
