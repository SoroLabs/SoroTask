"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

type ErrorSeverity = 'error' | 'warning' | 'info';

interface ErrorConfig {
  message: string;
  severity: ErrorSeverity;
  recoverable: boolean;
  suggestion?: string;
}

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, ErrorConfig> = {
    Configuration: {
      message: "There is a problem with the server configuration.",
      severity: 'error',
      recoverable: false,
      suggestion: "Please contact support with this error code."
    },
    AccessDenied: {
      message: "You do not have permission to sign in.",
      severity: 'error',
      recoverable: false,
      suggestion: "Contact your administrator if you believe this is an error."
    },
    Verification: {
      message: "The verification token has expired or has already been used.",
      severity: 'warning',
      recoverable: true,
      suggestion: "Please request a new verification email."
    },
    Default: {
      message: "An error occurred during authentication. Please try again.",
      severity: 'error',
      recoverable: true
    },
    OAuthSignin: {
      message: "Error in constructing an authorization URL.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please try signing in again."
    },
    OAuthCallback: {
      message: "Error in handling the callback from the OAuth provider.",
      severity: 'warning',
      recoverable: true,
      suggestion: "The authentication may have been canceled. Please try again."
    },
    OAuthCreateAccount: {
      message: "Could not create OAuth provider account in the database.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please try again or contact support if the issue persists."
    },
    OAuthAccountNotLinked: {
      message: "This email is already associated with another account.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please sign in with the original provider you used to create your account."
    },
    EmailCreateAccount: {
      message: "Could not create user account.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please try again or contact support."
    },
    EmailSignin: {
      message: "Failed to send verification email.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please check your email address and try again."
    },
    Callback: {
      message: "Error in the OAuth callback handler.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please try signing in again."
    },
    OAuthProfile: {
      message: "Failed to retrieve user profile from OAuth provider.",
      severity: 'error',
      recoverable: true,
      suggestion: "Please ensure the provider has granted necessary permissions."
    },
    SessionRequired: {
      message: "You must be signed in to access this page.",
      severity: 'info',
      recoverable: true,
      suggestion: "Please sign in to continue."
    },
  };

  const errorConfig = error ? errorMessages[error] || errorMessages.Default : errorMessages.Default;

  const getIconColor = () => {
    switch (errorConfig.severity) {
      case 'error': return 'text-red-500 bg-red-500/10';
      case 'warning': return 'text-yellow-500 bg-yellow-500/10';
      case 'info': return 'text-blue-500 bg-blue-500/10';
    }
  };

  const getIcon = () => {
    switch (errorConfig.severity) {
      case 'error':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'info':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-8 shadow-xl">
          {/* Error Icon */}
          <div className="flex justify-center mb-6">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${getIconColor()}`}>
              {getIcon()}
            </div>
          </div>

          {/* Error Message */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">
              {errorConfig.severity === 'error' ? 'Authentication Error' : 
               errorConfig.severity === 'warning' ? 'Authentication Warning' : 
               'Authentication Notice'}
            </h1>
            <p className="text-neutral-400">{errorConfig.message}</p>
            {errorConfig.suggestion && (
              <p className="text-sm text-neutral-500 mt-3">{errorConfig.suggestion}</p>
            )}
            {error && (
              <p className="text-xs text-neutral-500 mt-4 font-mono">Error code: {error}</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {errorConfig.recoverable && (
              <Link
                href="/auth/signin"
                className="block w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-all duration-200 text-center shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30"
              >
                Try Again
              </Link>
            )}
            <Link
              href="/"
              className="block w-full bg-neutral-700 hover:bg-neutral-600 text-white font-medium py-3 rounded-lg transition-all duration-200 text-center"
            >
              Return to Home
            </Link>
          </div>

          {/* Help Text */}
          {!errorConfig.recoverable && (
            <p className="text-center text-sm text-neutral-400 mt-6">
              If this problem persists, please contact support with the error code above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans flex items-center justify-center p-6">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AuthErrorContent />
    </Suspense>
  );
}
