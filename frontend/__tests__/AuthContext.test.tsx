/**
 * AuthContext Tests
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import type { User } from '@/types/auth';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

const TestComponent = () => {
  const { user, isAuthenticated, isLoading, login, logout, hasPermission } = useAuth();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'loaded'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="user">{user?.name || 'no user'}</div>
      <div data-testid="has-permission">{hasPermission('tasks:read') ? 'yes' : 'no'}</div>
      <button onClick={() => login({ id: '1', address: 'test', role: 'user', permissions: ['tasks:read'], name: 'Test' })}>
        Login
      </button>
      <button onClick={logout}>Logout</button>
    </div>
  );
};

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('initializes with loading state', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('no');
  });

  it('loads stored user on mount', async () => {
    const mockUser: User = {
      id: '1',
      address: 'stored_user',
      role: 'user',
      permissions: ['tasks:read'],
      name: 'Stored User',
    };

    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockUser));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('yes');
      expect(screen.getByTestId('user')).toHaveTextContent('Stored User');
    });
  });

  it('handles login successfully', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
    });

    // Click login button
    act(() => {
      screen.getByText('Login').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('yes');
      expect(screen.getByTestId('user')).toHaveTextContent('Test');
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  it('handles logout', async () => {
    const mockUser: User = {
      id: '1',
      address: 'test_user',
      role: 'user',
      permissions: ['tasks:read'],
      name: 'Test User',
    };

    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockUser));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Wait for user to load
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('yes');
    });

    // Click logout
    act(() => {
      screen.getByText('Logout').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('no');
      expect(screen.getByTestId('user')).toHaveTextContent('no user');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('sorotask_auth');
    });
  });

  it('checks permissions correctly', async () => {
    const mockUser: User = {
      id: '1',
      address: 'test_user',
      role: 'user',
      permissions: ['tasks:read', 'tasks:create'],
      name: 'Test User',
    };

    localStorageMock.getItem.mockReturnValue(JSON.stringify(mockUser));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('has-permission')).toHaveTextContent('yes');
    });
  });

  it('handles invalid stored user data', async () => {
    localStorageMock.getItem.mockReturnValue('invalid json');

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('no');
    });
  });
});