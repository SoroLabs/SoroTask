"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Capability = {
  key: string;
  label: string;
  description: string;
  bit: number;
};

type ProtocolRole = {
  id: string;
  name: string;
  description: string;
  permissions: number;
};

type Assignment = {
  id: string;
  principal: string;
  roleId: string;
  status: "active" | "revoked";
};

type Delegation = {
  id: string;
  principal: string;
  roleId: string;
  expiresAt: string;
  approvals: number;
  status: "pending" | "active" | "revoked";
};

type AuditEvent = {
  id: string;
  action: "assignment" | "revocation" | "permission" | "delegation";
  summary: string;
  actor: string;
  createdAt: string;
};

const CAPABILITIES: Capability[] = [
  { key: "create", label: "Create", description: "Create protocol tasks", bit: 0 },
  { key: "pause", label: "Pause", description: "Pause protocol operations", bit: 1 },
  { key: "emergency", label: "Emergency", description: "Trigger emergency controls", bit: 2 },
  { key: "sweep", label: "Sweep", description: "Withdraw protocol funds", bit: 3 },
  { key: "upgrade", label: "Upgrade", description: "Upgrade protocol contracts", bit: 4 },
];

const INITIAL_ROLES: ProtocolRole[] = [
  { id: "protocol-admin", name: "Protocol Admin", description: "Full protocol control", permissions: 31 },
  { id: "operator", name: "Operator", description: "Operations and emergency response", permissions: 6 },
  { id: "treasury", name: "Treasury", description: "Treasury management", permissions: 8 },
  { id: "observer", name: "Observer", description: "Read-only monitoring", permissions: 0 },
];

const INITIAL_ASSIGNMENTS: Assignment[] = [
  { id: "assignment-1", principal: "GAB7…Q4KP", roleId: "protocol-admin", status: "active" },
  { id: "assignment-2", principal: "GC2M…8VXD", roleId: "operator", status: "active" },
  { id: "assignment-3", principal: "GDF9…2JLA", roleId: "treasury", status: "active" },
  { id: "assignment-4", principal: "GBK1…5WNP", roleId: "observer", status: "active" },
];

const INITIAL_DELEGATIONS: Delegation[] = [
  {
    id: "ticket-1042",
    principal: "GCF2…7KLM",
    roleId: "operator",
    expiresAt: "2026-10-26T17:00:00.000Z",
    approvals: 2,
    status: "active",
  },
  {
    id: "ticket-1041",
    principal: "GAQ8…3NRT",
    roleId: "treasury",
    expiresAt: "2026-10-24T12:00:00.000Z",
    approvals: 1,
    status: "pending",
  },
];

const INITIAL_AUDIT: AuditEvent[] = [
  {
    id: "event-1",
    action: "delegation",
    summary: "Operator delegation issued to GCF2…7KLM",
    actor: "GAB7…Q4KP",
    createdAt: "2026-10-18T17:42:00Z",
  },
  {
    id: "event-2",
    action: "permission",
    summary: "Sweep permission removed from Operator",
    actor: "GAB7…Q4KP",
    createdAt: "2026-10-18T15:16:00Z",
  },
  {
    id: "event-3",
    action: "assignment",
    summary: "Treasury role assigned to GDF9…2JLA",
    actor: "GAB7…Q4KP",
    createdAt: "2026-10-17T11:03:00Z",
  },
];

const controlClass =
  "rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function makeEvent(action: AuditEvent["action"], summary: string): AuditEvent {
  return {
    id: `${Date.now()}-${Math.random()}`,
    action,
    summary,
    actor: "GAB7…Q4KP",
    createdAt: new Date().toISOString(),
  };
}

export function RbacDashboard() {
  const [roles, setRoles] = useState(INITIAL_ROLES);
  const [selectedRoleId, setSelectedRoleId] = useState(INITIAL_ROLES[1].id);
  const [draftPermissions, setDraftPermissions] = useState(INITIAL_ROLES[1].permissions);
  const [assignments, setAssignments] = useState(INITIAL_ASSIGNMENTS);
  const [delegations, setDelegations] = useState(INITIAL_DELEGATIONS);
  const [audit, setAudit] = useState(INITIAL_AUDIT);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [delegationDialogOpen, setDelegationDialogOpen] = useState(false);
  const [principal, setPrincipal] = useState("");
  const [roleId, setRoleId] = useState(INITIAL_ROLES[1].id);
  const [expiresAt, setExpiresAt] = useState("");
  const [auditFilter, setAuditFilter] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [now, setNow] = useState(0);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];
  const activeAssignments = assignments.filter((assignment) => assignment.status === "active");
  const activeDelegations = delegations.filter(
    (delegation) => delegation.status === "active" && new Date(delegation.expiresAt).getTime() > now,
  );

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const filteredAudit = useMemo(
    () =>
      audit.filter((event) => {
        const matchesFilter = auditFilter === "all" || event.action === auditFilter;
        const query = auditSearch.trim().toLowerCase();
        const matchesSearch =
          !query ||
          `${event.summary} ${event.actor}`.toLowerCase().includes(query);
        return matchesFilter && matchesSearch;
      }),
    [audit, auditFilter, auditSearch],
  );

  const addAudit = (event: AuditEvent) => setAudit((current) => [event, ...current]);

  const selectRole = (nextRoleId: string) => {
    setSelectedRoleId(nextRoleId);
    setDraftPermissions(roles.find((role) => role.id === nextRoleId)?.permissions ?? 0);
  };

  const togglePermission = (bit: number) => {
    setDraftPermissions((current) => current ^ (1 << bit));
  };

  const savePermissions = () => {
    const changed = selectedRole.permissions ^ draftPermissions;
    if (!changed) return;
    const changedLabels = CAPABILITIES.filter((capability) => changed & (1 << capability.bit))
      .map((capability) => capability.label)
      .join(", ");
    setRoles((current) =>
      current.map((role) =>
        role.id === selectedRoleId ? { ...role, permissions: draftPermissions } : role,
      ),
    );
    addAudit(makeEvent("permission", `${selectedRole.name} permissions updated: ${changedLabels}`));
  };

  const submitAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = roles.find((role) => role.id === roleId);
    if (!selected || !principal.trim()) return;
    setAssignments((current) => [
      { id: `${Date.now()}`, principal: principal.trim(), roleId, status: "active" },
      ...current,
    ]);
    addAudit(makeEvent("assignment", `${selected.name} role assigned to ${principal.trim()}`));
    setPrincipal("");
    setAssignmentDialogOpen(false);
  };

  const revokeAssignment = (assignment: Assignment) => {
    const role = roles.find((item) => item.id === assignment.roleId);
    setAssignments((current) =>
      current.map((item) =>
        item.id === assignment.id ? { ...item, status: "revoked" } : item,
      ),
    );
    addAudit(makeEvent("revocation", `${role?.name ?? "Protocol"} role revoked from ${assignment.principal}`));
  };

  const submitDelegation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = roles.find((role) => role.id === roleId);
    if (!selected || !principal.trim() || !expiresAt) return;
    setDelegations((current) => [
      {
        id: `ticket-${Date.now()}`,
        principal: principal.trim(),
        roleId,
        expiresAt,
        approvals: 1,
        status: "pending",
      },
      ...current,
    ]);
    addAudit(makeEvent("delegation", `${selected.name} delegation requested for ${principal.trim()}`));
    setPrincipal("");
    setExpiresAt("");
    setDelegationDialogOpen(false);
  };

  const approveDelegation = (delegation: Delegation) => {
    const role = roles.find((item) => item.id === delegation.roleId);
    setDelegations((current) =>
      current.map((item) =>
        item.id === delegation.id ? { ...item, approvals: 2, status: "active" } : item,
      ),
    );
    addAudit(makeEvent("delegation", `${role?.name ?? "Protocol"} delegation approved for ${delegation.principal}`));
  };

  const revokeDelegation = (delegation: Delegation) => {
    setDelegations((current) =>
      current.map((item) =>
        item.id === delegation.id ? { ...item, status: "revoked" } : item,
      ),
    );
    addAudit(makeEvent("revocation", `Delegation ${delegation.id} revoked for ${delegation.principal}`));
  };

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-5 border-b border-neutral-800 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
              Security / Access control
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">RBAC administration</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
              Manage protocol roles, granular permissions, and time-limited delegation tickets.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 sm:self-auto">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Preview mode · not connected to a contract
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3" aria-label="RBAC summary">
          {[
            { label: "Protocol roles", value: roles.length, detail: "Configured permission sets" },
            { label: "Authorized operators", value: activeAssignments.length, detail: "Active role assignments" },
            { label: "Active delegations", value: activeDelegations.length, detail: "Time-limited access tickets" },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5">
              <p className="text-sm text-neutral-400">{metric.label}</p>
              <p className="mt-3 text-3xl font-semibold">{metric.value}</p>
              <p className="mt-1 text-xs text-neutral-500">{metric.detail}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 p-5">
              <div>
                <h2 className="text-lg font-semibold">Authorized protocol roles</h2>
                <p className="mt-1 text-sm text-neutral-400">Select a role to inspect its permission bitmask.</p>
              </div>
              <span className="rounded-full bg-neutral-800 px-2.5 py-1 font-mono text-xs text-neutral-300">
                {activeAssignments.length} active
              </span>
            </div>
            <div className="divide-y divide-neutral-800">
              {roles.map((role) => {
                const activeCount = activeAssignments.filter((item) => item.roleId === role.id).length;
                const selected = role.id === selectedRoleId;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => selectRole(role.id)}
                    aria-pressed={selected}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors ${
                      selected ? "bg-blue-500/10" : "hover:bg-neutral-800/50"
                    }`}
                  >
                    <span>
                      <span className="block font-medium">{role.name}</span>
                      <span className="mt-1 block text-xs text-neutral-400">{role.description}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-xs text-neutral-300">0x{role.permissions.toString(16).padStart(2, "0")}</span>
                      <span className="mt-1 block text-xs text-neutral-500">{activeCount} assigned</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 p-5">
              <div>
                <h2 className="text-lg font-semibold">Permission matrix</h2>
                <p className="mt-1 text-sm text-neutral-400">Toggle capabilities for {selectedRole.name}.</p>
              </div>
              <span className="rounded-full border border-neutral-700 px-2.5 py-1 font-mono text-xs text-neutral-300">
                Bitmask 0x{draftPermissions.toString(16).padStart(2, "0")}
              </span>
            </div>
            <div className="p-5">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[530px] text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-neutral-500">
                      <th className="pb-3 font-medium">Capability</th>
                      <th className="pb-3 font-medium">Bit</th>
                      <th className="pb-3 text-center font-medium">Enabled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {CAPABILITIES.map((capability) => {
                      const enabled = Boolean(draftPermissions & (1 << capability.bit));
                      return (
                        <tr key={capability.key}>
                          <td className="py-3">
                            <span className="block font-medium">{capability.label}</span>
                            <span className="text-xs text-neutral-500">{capability.description}</span>
                          </td>
                          <td className="font-mono text-neutral-400">0x{(1 << capability.bit).toString(16)}</td>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              aria-label={`${capability.label} permission`}
                              checked={enabled}
                              onChange={() => togglePermission(capability.bit)}
                              className="h-4 w-4 accent-blue-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-4">
                <p className="text-xs text-neutral-500">Edits apply to this preview only.</p>
                <button
                  type="button"
                  onClick={savePermissions}
                  disabled={selectedRole.permissions === draftPermissions}
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                >
                  Apply preview changes
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/70">
          <div className="flex flex-col justify-between gap-4 border-b border-neutral-800 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold">Role assignments</h2>
              <p className="mt-1 text-sm text-neutral-400">Grant or revoke protocol access for authorized principals.</p>
            </div>
            <button
              type="button"
              onClick={() => setAssignmentDialogOpen(true)}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700"
            >
              Assign role
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-neutral-950/60 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Principal</th>
                  <th className="px-5 py-3 font-medium">Protocol role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="px-5 py-4 font-mono text-neutral-300">{assignment.principal}</td>
                    <td className="px-5 py-4">{roles.find((role) => role.id === assignment.roleId)?.name}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs ${
                        assignment.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-neutral-800 text-neutral-400"
                      }`}>
                        {assignment.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {assignment.status === "active" && (
                        <button
                          type="button"
                          onClick={() => revokeAssignment(assignment)}
                          className="text-sm text-red-300 hover:text-red-200"
                          aria-label={`Revoke role from ${assignment.principal}`}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 p-5">
              <div>
                <h2 className="text-lg font-semibold">Delegation tickets</h2>
                <p className="mt-1 text-sm text-neutral-400">Time-expiring grants require 2 of 3 approvals.</p>
              </div>
              <button
                type="button"
                onClick={() => setDelegationDialogOpen(true)}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium hover:bg-neutral-700"
              >
                New delegation
              </button>
            </div>
            <div className="divide-y divide-neutral-800">
              {delegations.map((delegation) => {
                const expired =
                  delegation.status === "active" && new Date(delegation.expiresAt).getTime() <= now;
                const displayStatus = expired ? "expired" : delegation.status;
                return (
                  <div key={delegation.id} className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm text-neutral-200">{delegation.principal}</p>
                        <p className="mt-1 text-xs text-neutral-400">
                          {roles.find((role) => role.id === delegation.roleId)?.name} · expires {formatDate(delegation.expiresAt)}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${
                        displayStatus === "active"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : displayStatus === "pending"
                            ? "bg-amber-500/10 text-amber-200"
                            : "bg-neutral-800 text-neutral-400"
                      }`}>
                        {displayStatus}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-neutral-500">{delegation.id} · {delegation.approvals}/2 approvals</span>
                      <div className="flex gap-3">
                        {delegation.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => approveDelegation(delegation)}
                            className="text-xs font-medium text-blue-300 hover:text-blue-200"
                            aria-label={`Approve delegation ${delegation.id}`}
                          >
                            Approve (preview)
                          </button>
                        )}
                        {delegation.status !== "revoked" && !expired && (
                          <button
                            type="button"
                            onClick={() => revokeDelegation(delegation)}
                            className="text-xs font-medium text-red-300 hover:text-red-200"
                            aria-label={`Revoke delegation ${delegation.id}`}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70">
            <div className="border-b border-neutral-800 p-5">
              <h2 className="text-lg font-semibold">Role audit timeline</h2>
              <p className="mt-1 text-sm text-neutral-400">Filter and search role and permission changes.</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <select
                  value={auditFilter}
                  onChange={(event) => setAuditFilter(event.target.value)}
                  aria-label="Filter audit events"
                  className={`${controlClass} sm:w-44`}
                >
                  <option value="all">All events</option>
                  <option value="assignment">Assignments</option>
                  <option value="revocation">Revocations</option>
                  <option value="permission">Permissions</option>
                  <option value="delegation">Delegations</option>
                </select>
                <input
                  value={auditSearch}
                  onChange={(event) => setAuditSearch(event.target.value)}
                  placeholder="Search actor or change"
                  aria-label="Search audit timeline"
                  className={`${controlClass} min-w-0 flex-1`}
                />
              </div>
            </div>
            <ol className="space-y-0 p-5">
              {filteredAudit.length ? filteredAudit.map((event, index) => (
                <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {index < filteredAudit.length - 1 && (
                    <span className="absolute left-[5px] top-3 h-full w-px bg-neutral-800" aria-hidden="true" />
                  )}
                  <span className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-blue-400 bg-neutral-900" />
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-200">{event.summary}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {formatDate(event.createdAt)} · by <span className="font-mono">{event.actor}</span>
                    </p>
                  </div>
                </li>
              )) : (
                <li className="py-8 text-center text-sm text-neutral-500">No matching audit events.</li>
              )}
            </ol>
          </div>
        </section>

        <p className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-xs leading-relaxed text-neutral-400">
          Preview only: role changes, approvals, revocations, and audit events are held in page state. No wallet signature,
          contract call, persistent audit log, or real-time on-chain update is performed.
        </p>
      </div>

      {(assignmentDialogOpen || delegationDialogOpen) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAssignmentDialogOpen(false);
              setDelegationDialogOpen(false);
            }
          }}
        >
          <form
            onSubmit={delegationDialogOpen ? submitDelegation : submitAssignment}
            className="w-full max-w-lg space-y-5 rounded-2xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-dialog-title"
          >
            <div>
              <h2 id="role-dialog-title" className="text-xl font-semibold">
                {delegationDialogOpen ? "Create delegation ticket" : "Assign protocol role"}
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                {delegationDialogOpen
                  ? "The ticket stays pending until the 2-of-3 approval threshold is met."
                  : "Grant a protocol role to a principal in preview mode."}
              </p>
            </div>
            <label className="block space-y-2 text-sm">
              <span>Principal address</span>
              <input
                required
                value={principal}
                onChange={(event) => setPrincipal(event.target.value)}
                placeholder="Stellar public key"
                className={`${controlClass} w-full`}
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span>Protocol role</span>
              <select
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                className={`${controlClass} w-full`}
              >
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            {delegationDialogOpen && (
              <label className="block space-y-2 text-sm">
                <span>Expires at</span>
                <input
                  required
                  type="datetime-local"
                  min={new Date().toISOString().slice(0, 16)}
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className={`${controlClass} w-full`}
                />
              </label>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setAssignmentDialogOpen(false);
                  setDelegationDialogOpen(false);
                }}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold hover:bg-blue-400">
                {delegationDialogOpen ? "Create preview ticket" : "Grant preview role"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
