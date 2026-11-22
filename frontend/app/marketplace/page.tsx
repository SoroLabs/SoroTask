import type { Metadata } from 'next';
import Link from 'next/link';
import { KeeperMarketplace } from './components/KeeperMarketplace';

export const metadata: Metadata = {
  title: 'Marketplace | SoroTask',
  description: 'Browse keeper profiles, task templates, and priority execution bids.',
import type { Metadata } from "next";
import { KeeperMarketplace } from "./components/KeeperMarketplace";
import { TradingChart } from "@/src/components/TradingChart";

export const metadata: Metadata = {
  title: "Marketplace & Autonomous Trading | SoroTask",
  description:
    "Autonomous limit order management with TradingView chart integration, depth profiles, and keeper priority bidding.",
};

export default function MarketplacePage() {
  return (
    <div className="space-y-4">
      <div className="mx-6 mt-4 flex items-center justify-between border-b border-neutral-800 pb-3">
        <div className="flex gap-3">
          <Link
            href="/marketplace"
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow"
          >
            Keeper Bidding Marketplace
          </Link>
          <Link
            href="/marketplace/templates"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-neutral-300 hover:text-white hover:bg-neutral-800 transition"
          >
            Decentralized Template Marketplace →
          </Link>
        </div>
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-6xl mx-auto px-6 pt-6 pb-2">
        <TradingChart />
      </div>
      <KeeperMarketplace />
    </div>
  );
}
