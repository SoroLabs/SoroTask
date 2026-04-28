"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ProviderConfig {
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    router.push("/auth/signin?callbackUrl=/settings");
    return null;
  }

  const providerInfo: Record<string, ProviderConfig> = {
    github: {
      name: "GitHub",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
      ),
      color: "bg-neutral-800",
      description: "Sign in with your GitHub account"
    },
    google: {
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
      color: "bg-white",
      description: "Sign in with your Google account"
    },
    email: {
      name: "Email",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      color: "bg-blue-500",
      description: "Sign in with email and password"
    },
  };

  const currentProvider = session.user.provider || "email";
  const providerData = providerInfo[currentProvider] || providerInfo.email;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut({ callbackUrl: "/" });
    } catch (error) {
      setIsSigningOut(false);
    }
  };

  const getProviderStatus = (provider: string) => {
    if (provider === currentProvider) {
      return {
        status: 'connected',
        label: 'Active',
        color: 'bg-green-500/10 text-green-400 border-green-500/20'
      };
    }
    return {
      status: 'disconnected',
      label: 'Not Connected',
      color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20'
    };
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">S</div>
            <h1 className="text-xl font-bold tracking-tight">SoroTask</h1>
          </div>
          <button
            onClick={() => router.push("/")}
            className="bg-neutral-800 hover:bg-neutral-700 text-neutral-100 px-4 py-2 rounded-md font-medium transition-colors border border-neutral-700/50"
          >
            Back to Home
          </button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Account Settings</h1>

        {/* Profile Section */}
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 shadow-xl mb-6">
          <h2 className="text-xl font-semibold mb-4">Profile Information</h2>
          <div className="flex items-center gap-4 mb-6">
            {session.user.image ? (
              <img
                src={session.user.image}
                alt={session.user.name || "User"}
                className="w-16 h-16 rounded-full"
              />
            ) : (
              <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-2xl font-bold">
                {session.user.name?.[0] || "U"}
              </div>
            )}
            <div>
              <p className="text-lg font-medium">{session.user.name || "User"}</p>
              <p className="text-neutral-400">{session.user.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-neutral-400 mb-1">User ID</p>
              <p className="font-mono">{session.user.id}</p>
            </div>
            <div>
              <p className="text-neutral-400 mb-1">Provider Account ID</p>
              <p className="font-mono">{session.user.providerAccountId || "N/A"}</p>
            </div>
          </div>
        </div>

        {/* Connected Providers Section */}
        <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 shadow-xl mb-6">
          <h2 className="text-xl font-semibold mb-4">Connected Providers</h2>
          <div className="space-y-3">
            {Object.entries(providerInfo).map(([providerId, provider]) => {
              const status = getProviderStatus(providerId);
              return (
                <div 
                  key={providerId}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                    status.status === 'connected' 
                      ? 'bg-neutral-900/50 border-neutral-700/50' 
                      : 'bg-neutral-900/30 border-neutral-700/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${provider.color}`}>
                      {provider.icon}
                    </div>
                    <div>
                      <p className="font-medium">{provider.name}</p>
                      <p className="text-sm text-neutral-400">{provider.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 p-4 bg-blue-500/5 border border-blue-500/10 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-blue-300 font-medium mb-1">Account Linking</p>
                <p className="text-sm text-neutral-400">
                  Your account is currently linked to {providerData.name}. 
                  In the future, you'll be able to link additional providers for seamless access.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-semibold mb-4 text-red-400">Danger Zone</h2>
          <p className="text-neutral-400 mb-4">
            Once you sign out, you'll need to authenticate again to access your account.
            Your session will be terminated across all devices.
          </p>
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-red-600/20"
          >
            {isSigningOut ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Signing out...
              </span>
            ) : (
              "Sign Out"
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
