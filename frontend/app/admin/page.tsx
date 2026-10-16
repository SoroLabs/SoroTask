/**
 * Admin Dashboard Page
 * Protected page for administrative functions
 */

"use client";

import React, { useState } from "react";
import { withRouteGuard } from "@/lib/routeGuards";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "@/hooks/useI18n";
import {
  UpgradeModal,
  DEFAULT_PROPOSAL,
  type UpgradeProposal,
} from "@/src/components/UpgradeModal";
import { StorageInspector } from "@/src/components/StorageInspector";

function AdminPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [activeProposal, setActiveProposal] =
    useState<UpgradeProposal>(DEFAULT_PROPOSAL);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-neutral-900 mb-8">
          {t("admin.title", { defaultValue: "Admin Dashboard" })}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* User Management Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-neutral-800 mb-4">
              {t("admin.users.title", { defaultValue: "User Management" })}
            </h2>
            <p className="text-neutral-600 mb-4">
              {t("admin.users.description", {
                defaultValue: "Manage user accounts and permissions",
              })}
            </p>
            <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
              {t("admin.users.manage", { defaultValue: "Manage Users" })}
            </button>
          </div>

          {/* System Settings Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-neutral-800 mb-4">
              {t("admin.settings.title", { defaultValue: "System Settings" })}
            </h2>
            <p className="text-neutral-600 mb-4">
              {t("admin.settings.description", {
                defaultValue: "Configure system-wide settings",
              })}
            </p>
            <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors">
              {t("admin.settings.configure", { defaultValue: "Configure" })}
            </button>
          </div>

          {/* System Health Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-neutral-800 mb-4">
              {t("admin.system.title", { defaultValue: "System Health" })}
            </h2>
            <p className="text-neutral-600 mb-4">
              {t("admin.system.description", {
                defaultValue: "Monitor system performance and health",
              })}
            </p>
            <button className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors">
              {t("admin.system.monitor", { defaultValue: "Monitor" })}
            </button>
          </div>

          {/* Contract Governance & Upgrades Card */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-neutral-800">
                {t("admin.governance.title", {
                  defaultValue: "Contract Upgrades",
                })}
              </h2>
              <span className="text-xs bg-purple-100 text-purple-700 font-semibold px-2 py-0.5 rounded">
                Active Vote
              </span>
            </div>
            <p className="text-neutral-600 mb-4 text-sm">
              Review proposed WASM hashes, bytecode diffs, independent audit
              reports, and cast timelock governance votes.
            </p>
            <button
              onClick={() => setIsUpgradeModalOpen(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition-colors text-sm font-medium"
            >
              Review Upgrade & Vote
            </button>
          </div>
        </div>

        {/* Contract Storage Inspector */}
        <div className="mt-8">
          <StorageInspector />
        </div>

        {/* Upgrade Governance Modal */}
        <UpgradeModal
          isOpen={isUpgradeModalOpen}
          proposal={activeProposal}
          onClose={() => setIsUpgradeModalOpen(false)}
        />

        {/* Current User Info */}
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-neutral-800 mb-4">
            {t("admin.current_user", { defaultValue: "Current User" })}
          </h2>
          <div className="space-y-2">
            <p>
              <strong>{t("admin.user.name", { defaultValue: "Name" })}:</strong>{" "}
              {user?.name}
            </p>
            <p>
              <strong>
                {t("admin.user.address", { defaultValue: "Address" })}:
              </strong>{" "}
              {user?.address}
            </p>
            <p>
              <strong>{t("admin.user.role", { defaultValue: "Role" })}:</strong>{" "}
              {user?.role}
            </p>
            <p>
              <strong>
                {t("admin.user.permissions", { defaultValue: "Permissions" })}:
              </strong>
            </p>
            <ul className="list-disc list-inside ml-4">
              {user?.permissions.map((permission) => (
                <li key={permission} className="text-sm text-neutral-600">
                  {permission}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withRouteGuard(AdminPage, ["admin:users"], {
  redirectTo: "/unauthorized",
  requireAll: false, // User needs any admin permission
});
