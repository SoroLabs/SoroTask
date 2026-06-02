'use client';

/**
 * RoleBasedAccessControl.tsx - UI for managing role-based access control in shared workspaces
 * 
 * Provides a comprehensive interface for:
 * - Managing workspace members
 * - Assigning custom permission sets
 * - Configuring role-based access for task management
 * - Auditing access changes
 */

import { useState, useEffect, useCallback } from 'react';

export type PermissionScope = 'read' | 'write' | 'admin' | 'execute';
export type ResourceType = 'task' | 'workspace' | 'portfolio';

export interface Permission {
  id: string;
  name: string;
  description: string;
  scope: PermissionScope;
  resourceType: ResourceType;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isCustom: boolean;
  createdAt: string;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
  lastActive: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  members: Member[];
  roles: Role[];
  owner: string;
  createdAt: string;
}

interface RoleBasedAccessControlProps {
  workspace: Workspace;
  onUpdateWorkspace: (workspace: Workspace) => Promise<void>;
  onAddMember: (email: string, roleId: string) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onUpdateMemberRole: (memberId: string, roleId: string) => Promise<void>;
  onCreateRole: (role: Omit<Role, 'id' | 'createdAt'>) => Promise<Role>;
  onUpdateRole: (roleId: string, role: Partial<Role>) => Promise<void>;
  onDeleteRole: (roleId: string) => Promise<void>;
}

const DEFAULT_PERMISSIONS: Permission[] = [
  {
    id: 'read_task',
    name: 'Read Tasks',
    description: 'View tasks and their details',
    scope: 'read',
    resourceType: 'task',
  },
  {
    id: 'write_task',
    name: 'Edit Tasks',
    description: 'Create and modify tasks',
    scope: 'write',
    resourceType: 'task',
  },
  {
    id: 'execute_task',
    name: 'Execute Tasks',
    description: 'Trigger task execution',
    scope: 'execute',
    resourceType: 'task',
  },
  {
    id: 'admin_workspace',
    name: 'Admin Workspace',
    description: 'Full workspace control',
    scope: 'admin',
    resourceType: 'workspace',
  },
];

const DEFAULT_ROLES: Role[] = [
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to workspace',
    permissions: [DEFAULT_PERMISSIONS[0]],
    isCustom: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Can create and modify tasks',
    permissions: [DEFAULT_PERMISSIONS[0], DEFAULT_PERMISSIONS[1]],
    isCustom: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'executor',
    name: 'Executor',
    description: 'Can execute tasks',
    permissions: [DEFAULT_PERMISSIONS[0], DEFAULT_PERMISSIONS[1], DEFAULT_PERMISSIONS[2]],
    isCustom: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Full workspace control',
    permissions: DEFAULT_PERMISSIONS,
    isCustom: false,
    createdAt: new Date().toISOString(),
  },
];

export function RoleBasedAccessControl({
  workspace,
  onUpdateWorkspace,
  onAddMember,
  onRemoveMember,
  onUpdateMemberRole,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
}: RoleBasedAccessControlProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'roles' | 'audit'>('members');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const availableRoles = [...DEFAULT_ROLES, ...workspace.roles.filter(r => r.isCustom)];

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail || !selectedRoleId) return;

    try {
      await onAddMember(newMemberEmail, selectedRoleId);
      setNewMemberEmail('');
      setSelectedRoleId('');
      setIsAddingMember(false);
    } catch (error) {
      console.error('Failed to add member:', error);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await onRemoveMember(memberId);
    } catch (error) {
      console.error('Failed to remove member:', error);
    }
  };

  const handleUpdateMemberRole = async (memberId: string, roleId: string) => {
    try {
      await onUpdateMemberRole(memberId, roleId);
    } catch (error) {
      console.error('Failed to update member role:', error);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName || selectedPermissions.size === 0) return;

    try {
      const permissions = DEFAULT_PERMISSIONS.filter(p => selectedPermissions.has(p.id));
      await onCreateRole({
        name: newRoleName,
        description: newRoleDescription,
        permissions,
        isCustom: true,
      });
      setNewRoleName('');
      setNewRoleDescription('');
      setSelectedPermissions(new Set());
      setIsCreatingRole(false);
    } catch (error) {
      console.error('Failed to create role:', error);
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    if (!confirm('Are you sure you want to delete this role?')) return;
    
    try {
      await onDeleteRole(roleId);
    } catch (error) {
      console.error('Failed to delete role:', error);
    }
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions(prev => {
      const next = new Set(prev);
      if (next.has(permissionId)) {
        next.delete(permissionId);
      } else {
        next.add(permissionId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{workspace.name}</h2>
          <p className="text-slate-400">{workspace.description}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('members')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'members'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Members ({workspace.members.length})
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'roles'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Roles ({availableRoles.length})
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'audit'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Audit Log
          </button>
        </div>
      </div>

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Workspace Members</h3>
            <button
              onClick={() => setIsAddingMember(!isAddingMember)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {isAddingMember ? 'Cancel' : 'Add Member'}
            </button>
          </div>

          {isAddingMember && (
            <form onSubmit={handleAddMember} className="bg-slate-800 p-4 rounded-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Role
                </label>
                <select
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">Select a role</option>
                  {availableRoles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
              >
                Add Member
              </button>
            </form>
          )}

          <div className="space-y-2">
            {workspace.members.map(member => (
              <div
                key={member.id}
                className="bg-slate-800 p-4 rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-white">{member.name}</p>
                    <p className="text-sm text-slate-400">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <select
                    value={member.role.id}
                    onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    disabled={member.id === workspace.owner}
                  >
                    {availableRoles.map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                  {member.id !== workspace.owner && (
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      className="text-red-400 hover:text-red-300 transition"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Roles & Permissions</h3>
            <button
              onClick={() => setIsCreatingRole(!isCreatingRole)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              {isCreatingRole ? 'Cancel' : 'Create Custom Role'}
            </button>
          </div>

          {isCreatingRole && (
            <form onSubmit={handleCreateRole} className="bg-slate-800 p-4 rounded-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Role Name
                </label>
                <input
                  type="text"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g., Task Manager"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Description
                </label>
                <textarea
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Describe what this role can do"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Permissions
                </label>
                <div className="space-y-2">
                  {DEFAULT_PERMISSIONS.map(permission => (
                    <label key={permission.id} className="flex items-center gap-3 p-2 bg-slate-900 rounded-lg">
                      <input
                        type="checkbox"
                        checked={selectedPermissions.has(permission.id)}
                        onChange={() => togglePermission(permission.id)}
                        className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <p className="text-white font-medium">{permission.name}</p>
                        <p className="text-sm text-slate-400">{permission.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
              >
                Create Role
              </button>
            </form>
          )}

          <div className="space-y-2">
            {availableRoles.map(role => (
              <div
                key={role.id}
                className="bg-slate-800 p-4 rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="font-medium text-white">{role.name}</h4>
                    <p className="text-sm text-slate-400">{role.description}</p>
                  </div>
                  {role.isCustom && (
                    <button
                      onClick={() => handleDeleteRole(role.id)}
                      className="text-red-400 hover:text-red-300 transition text-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {role.permissions.map(permission => (
                    <span
                      key={permission.id}
                      className="px-2 py-1 bg-slate-700 text-slate-300 rounded text-xs"
                    >
                      {permission.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Tab */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Audit Log</h3>
          <div className="bg-slate-800 p-4 rounded-lg">
            <p className="text-slate-400 text-center py-8">
              Audit log functionality coming soon
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
