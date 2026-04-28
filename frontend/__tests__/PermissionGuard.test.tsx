/**
 * PermissionGuard Component Tests
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PermissionGuard from '@/components/PermissionGuard';
import { AuthProvider } from '@/context/AuthContext';

// Mock the AuthContext
const mockUseAuth = jest.fn();
jest.mock('@/context/AuthContext', () => ({
  ...jest.requireActual('@/context/AuthContext'),
  useAuth: () => mockUseAuth(),
}));

const TestChild = () => <div>Test Content</div>;
const TestFallback = () => <div>Fallback Content</div>;

describe('PermissionGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders children when user has required permission (requireAll=true)', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn().mockReturnValue(true),
      hasAnyPermission: jest.fn(),
      isLoading: false,
    });

    render(
      <PermissionGuard permissions={['tasks:read']}>
        <TestChild />
      </PermissionGuard>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.queryByText('Fallback Content')).not.toBeInTheDocument();
  });

  it('renders children when user has any required permission (requireAll=false)', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn().mockReturnValue(true),
      isLoading: false,
    });

    render(
      <PermissionGuard permissions={['tasks:read', 'tasks:create']} requireAll={false}>
        <TestChild />
      </PermissionGuard>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('renders fallback when user lacks required permissions (requireAll=true)', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn().mockReturnValue(false),
      hasAnyPermission: jest.fn(),
      isLoading: false,
    });

    render(
      <PermissionGuard permissions={['tasks:read']} fallback={<TestFallback />}>
        <TestChild />
      </PermissionGuard>
    );

    expect(screen.getByText('Fallback Content')).toBeInTheDocument();
    expect(screen.queryByText('Test Content')).not.toBeInTheDocument();
  });

  it('renders fallback when user lacks any required permission (requireAll=false)', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn().mockReturnValue(false),
      isLoading: false,
    });

    render(
      <PermissionGuard permissions={['tasks:read', 'tasks:create']} requireAll={false} fallback={<TestFallback />}>
        <TestChild />
      </PermissionGuard>
    );

    expect(screen.getByText('Fallback Content')).toBeInTheDocument();
  });

  it('renders nothing while loading', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn(),
      isLoading: true,
    });

    render(
      <PermissionGuard permissions={['tasks:read']}>
        <TestChild />
      </PermissionGuard>
    );

    expect(screen.queryByText('Test Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Fallback Content')).not.toBeInTheDocument();
  });

  it('renders default fallback (null) when no fallback provided and permissions denied', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn().mockReturnValue(false),
      hasAnyPermission: jest.fn(),
      isLoading: false,
    });

    const { container } = render(
      <PermissionGuard permissions={['tasks:read']}>
        <TestChild />
      </PermissionGuard>
    );

    expect(container.firstChild).toBeNull();
  });
});