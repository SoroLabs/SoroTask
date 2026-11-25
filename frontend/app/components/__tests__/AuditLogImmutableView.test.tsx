import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AuditLogImmutableView } from '../AuditLogImmutableView';
import { AuditLogEntry } from '../../types/auditLog';

const mockLogs: AuditLogEntry[] = [
    { id: '1', timestamp: 1774883200000, action: 'contracts.pause', actor: 'GB3...22A', payloadHash: '0xabc', severity: 'critical' },
    { id: '2', timestamp: 1774883210000, action: 'tasks.assign', actor: 'GD2...99X', payloadHash: '0xdef', severity: 'info' },
];

describe('AuditLogImmutableView Concurrent Execution Suite', () => {
    let mockVerify: jest.Mock;

    beforeEach(() => {
        mockVerify = jest.fn().mockReturnValue(true); // Default to verified safe
    });

    it('should correctly render the data grid and output logs rows securely', () => {
        render(<AuditLogImmutableView initialLogs={mockLogs} onVerifyEntryTamper={mockVerify} />);
        
        expect(screen.getByText('contracts.pause')).toBeInTheDocument();
        expect(screen.getByText('tasks.assign')).toBeInTheDocument();
        expect(screen.getAllByText('VERIFIED SECURE')).toHaveLength(2);
    });

    it('should update query parameters and narrow table entries matching text updates', async () => {
        render(<AuditLogImmutableView initialLogs={mockLogs} onVerifyEntryTamper={mockVerify} />);
        
        const searchInput = screen.getByPlaceholderText(/Search by action signature/i);
        
        await act(async () => {
            fireEvent.change(searchInput, { target: { value: 'pause' } });
        });

        expect(screen.getByText('contracts.pause')).toBeInTheDocument();
        expect(screen.queryByText('tasks.assign')).not.toBeInTheDocument();
    });

    it('should render flash-alert warning indicators if hash mismatch blocks fail consistency checks', () => {
        mockVerify.mockImplementation((id: string) => id === '2'); // Id 1 breaks integrity rules
        render(<AuditLogImmutableView initialLogs={mockLogs} onVerifyEntryTamper={mockVerify} />);

        expect(screen.getByText('TAMPER DETECTED')).toBeInTheDocument();
    });
});