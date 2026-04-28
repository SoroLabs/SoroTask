/**
 * RouteGuard Component Tests
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RouteGuard } from '@/lib/routeGuards';

// Mock Next.js router
const mockPush = jest.fn();
const mockUseRouter = jest.fn(() => ({
  push: mockPush,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter(),
}));

// Mock the AuthContext
const mockUseAuth = jest.fn();
jest.mock('@/context/AuthContext', () => ({
  ...jest.requireActual('@/context/AuthContext'),
  useAuth: () => mockUseAuth(),
}));

const TestChild = () => <div>Protected Content</div>;
const TestFallback = () => <div>Loading...</div>;

describe('RouteGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders children when user is authenticated and has required permissions', async () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn().mockReturnValue(true),
      hasAnyPermission: jest.fn(),
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read']}>
        <TestChild />
      </RouteGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('redirects to login when user is not authenticated', async () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn(),
      isAuthenticated: false,
      isLoading: false,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read']}>
        <TestChild />
      </RouteGuard>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to custom path when user lacks permissions', async () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn().mockReturnValue(false),
      hasAnyPermission: jest.fn(),
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read']} redirectTo="/custom">
        <TestChild />
      </RouteGuard>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/custom');
    });
  });

  it('renders fallback while loading', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn(),
      isAuthenticated: false,
      isLoading: true,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read']} fallback={<TestFallback />}>
        <TestChild />
      </RouteGuard>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders default loading fallback when no fallback provided', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn(),
      isAuthenticated: false,
      isLoading: true,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read']}>
        <TestChild />
      </RouteGuard>
    );

    expect(screen.getByRole('status')).toBeInTheDocument(); // Loading spinner
  });

  it('renders fallback when authenticated but lacks permissions', () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn().mockReturnValue(false),
      hasAnyPermission: jest.fn(),
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read']} fallback={<TestFallback />}>
        <TestChild />
      </RouteGuard>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('works with requireAll=false (any permission)', async () => {
    mockUseAuth.mockReturnValue({
      hasAllPermissions: jest.fn(),
      hasAnyPermission: jest.fn().mockReturnValue(true),
      isAuthenticated: true,
      isLoading: false,
    });

    render(
      <RouteGuard requiredPermissions={['tasks:read', 'tasks:create']} requireAll={false}>
        <TestChild />
      </RouteGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });
});