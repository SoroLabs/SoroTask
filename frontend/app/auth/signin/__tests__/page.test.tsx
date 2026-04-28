/**
 * Tests for multi-provider authentication sign-in page
 * Covers edge cases: canceled auth, invalid callback state, loading states, error handling
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import SignInPage from '../page';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
}));

describe('SignInPage - Multi-Provider Auth', () => {
  const mockPush = jest.fn();
  const mockRefresh = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      refresh: mockRefresh,
    });
    (useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn(),
    });
  });

  describe('Provider Sign-In Flow', () => {
    it('should display all authentication providers', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      render(<SignInPage />);

      expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
      expect(screen.getByText('Continue with Google')).toBeInTheDocument();
    });

    it('should handle successful GitHub sign-in', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('/dashboard'),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: true, error: null });

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith('github', {
          callbackUrl: '/dashboard',
          redirect: false,
        });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
        expect(mockRefresh).toHaveBeenCalled();
      });
    });

    it('should handle successful Google sign-in', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('/settings'),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: true, error: null });

      render(<SignInPage />);

      const googleButton = screen.getByText('Continue with Google');
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith('google', {
          callbackUrl: '/settings',
          redirect: false,
        });
      });
    });

    it('should show loading state during provider sign-in', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
      );

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      expect(screen.getByText('Connecting to GitHub...')).toBeInTheDocument();
    });

    it('should disable all buttons while one provider is loading', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
      );

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      const googleButton = screen.getByText('Continue with Google');
      // Button should have disabled attribute or be in a disabled state
      expect(googleButton.closest('button')).toHaveAttribute('disabled');
    });
  });

  describe('Error Handling', () => {
    it('should display error when provider sign-in fails', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: false, error: 'OAuthCallback' });

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to sign in with github/i)).toBeInTheDocument();
      });
    });

    it('should handle OAuthAccountNotLinked error with specific message', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockResolvedValue({ 
        ok: false, 
        error: 'OAuthAccountNotLinked' 
      });

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(screen.getByText(/already linked to another provider/i)).toBeInTheDocument();
      });
    });

    it('should display error from URL params (canceled auth)', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          if (key === 'callbackUrl') return null;
          return null;
        }),
      });

      render(<SignInPage />);

      expect(screen.getByText(/authentication was canceled or failed/i)).toBeInTheDocument();
    });

    it('should allow dismissing recoverable errors', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          if (key === 'callbackUrl') return null;
          return null;
        }),
      });

      render(<SignInPage />);

      const dismissButton = screen.getByText('Dismiss');
      fireEvent.click(dismissButton);

      await waitFor(() => {
        expect(screen.queryByText(/authentication was canceled/i)).not.toBeInTheDocument();
      });
    });

    it('should handle network errors during sign-in', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(screen.getByText(/unexpected error occurred/i)).toBeInTheDocument();
      });
    });
  });

  describe('Email Sign-In Flow', () => {
    it('should toggle email form visibility', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      render(<SignInPage />);

      expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
      expect(screen.getByText('or continue with email')).toBeInTheDocument();

      const toggleButton = screen.getByText('or continue with email');
      fireEvent.click(toggleButton);

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByText('hide email form')).toBeInTheDocument();
    });

    it('should validate email format before submission', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      render(<SignInPage />);

      // Show email form
      fireEvent.click(screen.getByText('or continue with email'));

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByText('Sign in with Email');

      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      // signIn should not be called due to validation error
      expect(signIn).not.toHaveBeenCalled();
    });

    it('should validate password length before submission', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      render(<SignInPage />);

      // Show email form
      fireEvent.click(screen.getByText('or continue with email'));

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByText('Sign in with Email');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: '123' } });
      fireEvent.click(submitButton);

      // signIn should not be called due to validation error
      expect(signIn).not.toHaveBeenCalled();
    });

    it('should handle successful email sign-in', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue('/dashboard'),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: true, error: null });

      render(<SignInPage />);

      // Show email form
      fireEvent.click(screen.getByText('or continue with email'));

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByText('Sign in with Email');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith('credentials', {
          email: 'test@example.com',
          password: 'password123',
          callbackUrl: '/dashboard',
          redirect: false,
        });
      });
    });

    it('should handle invalid credentials error', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: false, error: 'CredentialsSignin' });

      render(<SignInPage />);

      // Show email form
      fireEvent.click(screen.getByText('or continue with email'));

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByText('Sign in with Email');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      });
    });
  });

  describe('Callback URL Handling', () => {
    it('should use default callback URL when none provided', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: true, error: null });

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith('github', {
          callbackUrl: '/',
          redirect: false,
        });
      });
    });

    it('should preserve custom callback URL', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'callbackUrl') return '/tasks/123';
          return null;
        }),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: true, error: null });

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith('github', {
          callbackUrl: '/tasks/123',
          redirect: false,
        });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/tasks/123');
      });
    });
  });

  describe('Loading States', () => {
    it('should show spinner during provider loading', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
      );

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should re-enable buttons after failed sign-in', async () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });
      (signIn as jest.Mock).mockResolvedValue({ ok: false, error: 'OAuthCallback' });

      render(<SignInPage />);

      const githubButton = screen.getByText('Continue with GitHub');
      fireEvent.click(githubButton);

      await waitFor(() => {
        expect(githubButton).not.toBeDisabled();
      });
    });
  });
});
