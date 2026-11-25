export type UserRole = 'OWNER' | 'OPERATOR' | 'AUDITOR';

export type ActionType = 
  | 'TASK_VIEW'
  | 'TASK_CREATE'
  | 'TASK_EXECUTE'
  | 'TASK_DELETE'
  | 'WALLET_SIGN'
  | 'SETTINGS_MANAGE';

export const ROLE_PERMISSIONS: Record<UserRole, Set<ActionType>> = {
  OWNER: new Set(['TASK_VIEW', 'TASK_CREATE', 'TASK_EXECUTE', 'TASK_DELETE', 'WALLET_SIGN', 'SETTINGS_MANAGE']),
  OPERATOR: new Set(['TASK_VIEW', 'TASK_CREATE', 'TASK_EXECUTE']),
  AUDITOR: new Set(['TASK_VIEW']),
};

export function hasPermission(role: UserRole, action: ActionType): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.has(action) : false;
}
