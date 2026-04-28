/**
 * Tests for authentication error page
 * Covers edge cases: different error types, recoverable vs non-recoverable errors
 */

import { render, screen } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import AuthErrorPage from '../page';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
}));

describe('AuthErrorPage - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Display', () => {
    it('should display default error when no error parameter', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText('Authentication Error')).toBeInTheDocument();
      expect(screen.getByText(/an error occurred during authentication/i)).toBeInTheDocument();
    });

    it('should display OAuthCallback error as warning', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText('Authentication Warning')).toBeInTheDocument();
      expect(screen.getByText(/error in handling the callback/i)).toBeInTheDocument();
      expect(screen.getByText(/authentication may have been canceled/i)).toBeInTheDocument();
    });

    it('should display OAuthAccountNotLinked error with specific suggestion', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthAccountNotLinked';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/email is already associated with another account/i)).toBeInTheDocument();
      expect(screen.getByText(/sign in with the original provider/i)).toBeInTheDocument();
    });

    it('should display Configuration error as non-recoverable', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'Configuration';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/problem with the server configuration/i)).toBeInTheDocument();
      expect(screen.getByText(/contact support with this error code/i)).toBeInTheDocument();
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });

    it('should display AccessDenied error as non-recoverable', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'AccessDenied';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/do not have permission to sign in/i)).toBeInTheDocument();
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });

    it('should display SessionRequired error as info', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'SessionRequired';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText('Authentication Notice')).toBeInTheDocument();
      expect(screen.getByText(/must be signed in to access this page/i)).toBeInTheDocument();
    });

    it('should display Verification error as warning', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'Verification';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText('Authentication Warning')).toBeInTheDocument();
      expect(screen.getByText(/verification token has expired/i)).toBeInTheDocument();
      expect(screen.getByText(/request a new verification email/i)).toBeInTheDocument();
    });
  });

  describe('Recovery Actions', () => {
    it('should show Try Again button for recoverable errors', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should not show Try Again button for non-recoverable errors', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'Configuration';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });

    it('should always show Return to Home button', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText('Return to Home')).toBeInTheDocument();
    });

    it('should link Try Again to sign-in page', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      const tryAgainButton = screen.getByText('Try Again');
      expect(tryAgainButton.closest('a')).toHaveAttribute('href', '/auth/signin');
    });

    it('should link Return to Home to root', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      const homeButton = screen.getByText('Return to Home');
      expect(homeButton.closest('a')).toHaveAttribute('href', '/');
    });
  });

  describe('Error Code Display', () => {
    it('should display error code when present', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/Error code: OAuthCallback/i)).toBeInTheDocument();
    });

    it('should not display error code when not present', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn().mockReturnValue(null),
      });

      render(<AuthErrorPage />);

      expect(screen.queryByText(/Error code:/i)).not.toBeInTheDocument();
    });
  });

  describe('Visual Indicators', () => {
    it('should show error icon for error severity', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthSignin';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      const iconContainer = document.querySelector('.bg-red-500\\/10');
      expect(iconContainer).toBeInTheDocument();
    });

    it('should show warning icon for warning severity', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      const iconContainer = document.querySelector('.bg-yellow-500\\/10');
      expect(iconContainer).toBeInTheDocument();
    });

    it('should show info icon for info severity', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'SessionRequired';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      const iconContainer = document.querySelector('.bg-blue-500\\/10');
      expect(iconContainer).toBeInTheDocument();
    });
  });

  describe('Help Text', () => {
    it('should show contact support message for non-recoverable errors', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'Configuration';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/contact support with the error code/i)).toBeInTheDocument();
    });

    it('should not show contact support message for recoverable errors', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthCallback';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.queryByText(/contact support/i)).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle unknown error codes with default message', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'UnknownError';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/an error occurred during authentication/i)).toBeInTheDocument();
    });

    it('should handle EmailCreateAccount error', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'EmailCreateAccount';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/could not create user account/i)).toBeInTheDocument();
    });

    it('should handle EmailSignin error', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'EmailSignin';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/failed to send verification email/i)).toBeInTheDocument();
    });

    it('should handle OAuthProfile error', () => {
      (useSearchParams as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) => {
          if (key === 'error') return 'OAuthProfile';
          return null;
        }),
      });

      render(<AuthErrorPage />);

      expect(screen.getByText(/failed to retrieve user profile/i)).toBeInTheDocument();
    });
  });
});
