"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

type AuthError = {
  message: string;
  type: 'error' | 'warning' | 'info';
  recoverable: boolean;
};

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isEmailFormVisible, setIsEmailFormVisible] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") || "/";

  // Handle error from URL params (e.g., canceled auth)
  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      const errorMessages: Record<string, AuthError> = {
        OAuthSignin: {
          message: "Failed to initiate sign in with the provider. Please try again.",
          type: 'error',
          recoverable: true
        },
        OAuthCallback: {
          message: "The authentication was canceled or failed. Please try again.",
          type: 'warning',
          recoverable: true
        },
        OAuthCreateAccount: {
          message: "Failed to create account. Please try again or contact support.",
          type: 'error',
          recoverable: true
        },
        OAuthAccountNotLinked: {
          message: "This email is already associated with another account. Please sign in with the original provider.",
          type: 'error',
          recoverable: true
        },
        SessionRequired: {
          message: "You must be signed in to access this page.",
          type: 'info',
          recoverable: true
        },
        Default: {
          message: "An error occurred during authentication. Please try again.",
          type: 'error',
          recoverable: true
        },
      };
      setError(errorMessages[errorParam] || errorMessages.Default);
    }
  }, [searchParams]);

  const handleProviderSignIn = async (providerId: string) => {
    setLoading(providerId);
    setError(null);
    
    try {
      const result = await signIn(providerId, {
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        setError({
          message: `Failed to sign in with ${providerId}. ${result.error === 'OAuthAccountNotLinked' 
            ? 'This account is already linked to another provider.' 
            : 'Please try again.'}`,
          type: 'error',
          recoverable: true
        });
        setLoading(null);
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError({
        message: 'An unexpected error occurred. Please try again.',
        type: 'error',
        recoverable: true
      });
      setLoading(null);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate email format
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError({
        message: 'Please enter a valid email address.',
        type: 'error',
        recoverable: true
      });
      return;
    }
    
    // Validate password
    if (!password || password.length < 6) {
      setError({
        message: 'Password must be at least 6 characters.',
        type: 'error',
        recoverable: true
      });
      return;
    }
    
    setLoading("email");
    setError(null);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        setError({
          message: 'Invalid email or password.',
          type: 'error',
          recoverable: true
        });
        setLoading(null);
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError({
        message: 'An unexpected error occurred. Please try again.',
        type: 'error',
        recoverable: true
      });
      setLoading(null);
    }
  };

  const providers = [
    {
      id: "github",
      name: "GitHub",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      ),
      bgColor: "bg-neutral-800 hover:bg-neutral-700",
      textColor: "text-white",
    },
    {
      id: "google",
      name: "Google",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      ),
      bgColor: "bg-white hover:bg-neutral-100",
      textColor: "text-neutral-900",
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-8 shadow-xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center font-bold text-white text-xl shadow-lg shadow-blue-500/20 mx-auto mb-4">
              S
            </div>
            <h1 className="text-2xl font-bold">Sign in to SoroTask</h1>
            <p className="text-neutral-400 mt-2">Choose your preferred sign-in method</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className={`mb-6 p-4 rounded-lg border ${
              error.type === 'error' 
                ? 'bg-red-500/10 border-red-500/20' 
                : error.type === 'warning'
                ? 'bg-yellow-500/10 border-yellow-500/20'
                : 'bg-blue-500/10 border-blue-500/20'
            }`}>
              <div className="flex items-start gap-3">
                {error.type === 'error' && (
                  <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {error.type === 'warning' && (
                  <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                {error.type === 'info' && (
                  <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <div className="flex-1">
                  <p className={`text-sm ${
                    error.type === 'error' 
                      ? 'text-red-400' 
                      : error.type === 'warning'
                      ? 'text-yellow-400'
                      : 'text-blue-400'
                  }`}>{error.message}</p>
                  {error.recoverable && (
                    <button
                      onClick={() => setError(null)}
                      className="mt-2 text-sm underline opacity-75 hover:opacity-100"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* OAuth Providers */}
          <div className="space-y-3 mb-6">
            {providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => handleProviderSignIn(provider.id)}
                disabled={loading !== null}
                className={`w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200 border border-neutral-700/50 ${provider.bgColor} ${provider.textColor} ${
                  loading === provider.id 
                    ? "opacity-50 cursor-not-allowed scale-[0.98]" 
                    : "hover:scale-[1.02] active:scale-[0.98]"
                } ${loading !== null && loading !== provider.id ? "opacity-60" : ""}`}
              >
                {loading === provider.id ? (
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  provider.icon
                )}
                <span className="font-medium">
                  {loading === provider.id
                    ? `Connecting to ${provider.name}...`
                    : `Continue with ${provider.name}`}
                </span>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-700/50"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <button
                onClick={() => setIsEmailFormVisible(!isEmailFormVisible)}
                className="px-4 bg-neutral-800/50 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
              >
                {isEmailFormVisible ? 'hide email form' : 'or continue with email'}
              </button>
            </div>
          </div>

          {/* Email Form */}
          {isEmailFormVisible && (
            <form onSubmit={handleEmailSignIn} className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-neutral-400 mb-1">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={loading !== null}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-neutral-400 mb-1">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading !== null}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={loading !== null}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30"
              >
                {loading === "email" ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  "Sign in with Email"
                )}
              </button>
            </form>
          )}

          {/* Footer */}
          <p className="text-center text-sm text-neutral-400 mt-6">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans flex items-center justify-center p-6">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
