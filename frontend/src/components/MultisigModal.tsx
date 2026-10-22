"use client";

import { useEffect } from "react";
import MultiSigTaskRegistration from "@/app/components/MultiSigTaskRegistration";

type MultisigModalProps = {
  open: boolean;
  onClose: () => void;
};

export function MultisigModal({ open, onClose }: MultisigModalProps) {
  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="multisig-modal-title"
        className="my-auto w-full max-w-4xl rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-neutral-800 px-6 py-5">
          <div>
            <h2 id="multisig-modal-title" className="text-xl font-semibold text-white">
              Multi-Sig Coordination
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Review task proposals and threshold progress.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close multi-sig coordination"
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Close
          </button>
        </header>
        <div className="p-4 sm:p-6">
          <MultiSigTaskRegistration />
          <p className="mt-4 text-xs leading-5 text-amber-200/80">
            Approvals in this interface are currently recorded locally. They are
            not independently verified wallet signatures and do not establish an
            on-chain multisig threshold.
          </p>
        </div>
      </section>
    </div>
  );
}
