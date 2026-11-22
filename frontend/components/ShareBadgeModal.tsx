"use client";

import React, { useState } from "react";
import {
  X,
  Share2,
  Award,
  CheckCircle,
  Copy,
  ExternalLink,
  QrCode,
  Send,
} from "lucide-react";

export interface MilestoneData {
  taskId: string;
  taskTitle: string;
  executionsCount: number;
  volumeAutomated: string;
  gasSaved: string;
  txHash?: string;
  completedAt?: string;
}

export interface ShareBadgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestone?: MilestoneData;
}

const DEFAULT_MILESTONE: MilestoneData = {
  taskId: "task-comp-789",
  taskTitle: "Multi-Hop Arbitrage & Liquidity Rebalance",
  executionsCount: 100,
  volumeAutomated: "1,250 XLM",
  gasSaved: "52.4 XLM",
  txHash: "8a4d7c58...99ef3a1b",
  completedAt: new Date().toISOString().split("T")[0],
};

export const ShareBadgeModal: React.FC<ShareBadgeModalProps> = ({
  isOpen,
  onClose,
  milestone = DEFAULT_MILESTONE,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://sorotask.io";
  const ogImageUrl = `${baseUrl}/api/og?taskId=${encodeURIComponent(
    milestone.taskId,
  )}&title=${encodeURIComponent(milestone.taskTitle)}&runs=${
    milestone.executionsCount
  }&volume=${encodeURIComponent(milestone.volumeAutomated)}&gasSaved=${encodeURIComponent(
    milestone.gasSaved,
  )}`;
  const shareableUrl = `${baseUrl}/tasks/${milestone.taskId}?proof=true`;

  const shareText = `🚀 Just automated ${milestone.volumeAutomated} across ${milestone.executionsCount} runs on @SoroTask! Verified on-chain via @StellarOrg Soroban: ${shareableUrl}`;

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    shareText,
  )}`;

  const farcasterUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(
    shareText,
  )}&embeds[]=${encodeURIComponent(ogImageUrl)}`;

  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    shareableUrl,
  )}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      data-testid="share-badge-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl text-neutral-100 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold">
              Proof-of-Automation Credential
            </h3>
            <p className="text-sm text-neutral-400">
              Share verifiable on-chain milestone proof across social channels
            </p>
          </div>
        </div>

        {/* Badge Preview Card */}
        <div
          data-testid="badge-card"
          className="relative bg-gradient-to-br from-indigo-950/70 via-neutral-950 to-emerald-950/50 border border-indigo-500/30 rounded-xl p-5 mb-6 shadow-lg"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Verified On-Chain Milestone
            </span>
            <span className="text-xs text-neutral-400 font-mono">
              Task #{milestone.taskId}
            </span>
          </div>

          <h4 className="text-lg font-bold text-white mb-3">
            {milestone.taskTitle}
          </h4>

          {/* Metrics */}
          <div className="grid grid-cols-3 gap-3 bg-neutral-900/80 border border-neutral-800 rounded-lg p-3 text-center mb-4">
            <div>
              <span className="block text-[11px] text-neutral-400 uppercase">
                Executions
              </span>
              <span className="text-base font-bold text-indigo-400">
                {milestone.executionsCount} runs
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-neutral-400 uppercase">
                Volume
              </span>
              <span className="text-base font-bold text-emerald-400">
                {milestone.volumeAutomated}
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-neutral-400 uppercase">
                Gas Saved
              </span>
              <span className="text-base font-bold text-amber-400">
                {milestone.gasSaved}
              </span>
            </div>
          </div>

          {/* Verification Footer with Simulated QR & Hash */}
          <div className="flex items-center justify-between pt-3 border-t border-neutral-800/80 text-xs">
            <div className="flex items-center gap-2 text-neutral-400 font-mono">
              <QrCode className="w-5 h-5 text-indigo-400" />
              <span>Tx: {milestone.txHash}</span>
            </div>
            <span className="text-neutral-500">{milestone.completedAt}</span>
          </div>
        </div>

        {/* Shareable Link Input */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-neutral-400 mb-1.5">
            Shareable Proof Link
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={shareableUrl}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-300 font-mono focus:outline-none"
            />
            <button
              onClick={handleCopy}
              data-testid="copy-share-link"
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Social Share Buttons */}
        <div>
          <span className="block text-xs font-medium text-neutral-400 mb-2">
            One-Click Share
          </span>
          <div className="grid grid-cols-3 gap-3">
            {/* Twitter / X */}
            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="share-twitter-btn"
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition-colors border border-neutral-700"
            >
              <svg className="w-4 h-4 fill-sky-400" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Twitter / X
            </a>

            {/* Farcaster / Warpcast */}
            <a
              href={farcasterUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="share-farcaster-btn"
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-purple-950/40 hover:bg-purple-900/50 text-purple-200 rounded-lg text-xs font-semibold transition-colors border border-purple-800/50"
            >
              <Share2 className="w-4 h-4 text-purple-400" />
              Farcaster
            </a>

            {/* LinkedIn */}
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="share-linkedin-btn"
              className="flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-950/40 hover:bg-blue-900/50 text-blue-200 rounded-lg text-xs font-semibold transition-colors border border-blue-800/50"
            >
              <ExternalLink className="w-4 h-4 text-blue-400" />
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareBadgeModal;
