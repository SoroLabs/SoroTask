export interface AuditLogEntry {
    id: string;
    timestamp: number;
    action: string;
    actor: string;
    payloadHash: string; // Cryptographic binding for immutability verification
    severity: 'info' | 'warning' | 'critical';
}

export interface AuditLogFilterOptions {
    searchQuery: string;
    severityFilter: 'all' | 'info' | 'warning' | 'critical';
}