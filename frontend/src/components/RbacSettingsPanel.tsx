"use client";

import RoleBasedAccessControl, {
  type Workspace,
} from "@/components/RoleBasedAccessControl";
import { useRbacUiEngine } from "../lib/rbac/RbacUiEngineProvider";
import { getRbacApi } from "../lib/rbac/api";

const defaultWorkspace: Workspace = {
  id: "ws-default",
  name: "Default Workspace",
  description: "Manage team access and roles",
  owner: "admin_address",
  createdAt: new Date().toISOString(),
  members: [],
  roles: [],
};

type RbacSettingsPanelProps = {
  workspace?: Workspace;
};

export function RbacSettingsPanel({
  workspace = defaultWorkspace,
}: RbacSettingsPanelProps) {
  const { connectionState, lastError, refreshPermissions } = useRbacUiEngine();
  const api = getRbacApi();

  const handleUpdate = async (updated: Workspace) => {
    await api.syncWorkspace(updated.id, updated);
    await refreshPermissions();
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Role-based Access Control</h2>
          <p className="text-sm text-neutral-400">
            Manage workspace members, roles, and permissions.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            connectionState === "online"
              ? "bg-emerald-500/10 text-emerald-300"
              : connectionState === "degraded"
                ? "bg-amber-500/10 text-amber-300"
                : "bg-rose-500/10 text-rose-300"
          }`}
        >
          {connectionState}
        </span>
      </div>

      {lastError && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          RBAC service unavailable — using cached permissions. {lastError}
        </p>
      )}

      <RoleBasedAccessControl
        workspace={workspace}
        onUpdateWorkspace={handleUpdate}
        onAddMember={async () => refreshPermissions()}
        onRemoveMember={async () => refreshPermissions()}
        onUpdateMemberRole={async () => refreshPermissions()}
        onCreateRole={async (role) => ({
          ...role,
          id: `role-${Date.now()}`,
          createdAt: new Date().toISOString(),
        })}
        onUpdateRole={async () => refreshPermissions()}
        onDeleteRole={async () => refreshPermissions()}
      />
    </section>
  );
}
