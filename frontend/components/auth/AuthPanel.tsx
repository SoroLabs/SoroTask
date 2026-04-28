"use client"

import { useState } from "react"

type Provider = "google" | "github" | "email"

export default function AuthPanel() {
  const [loading, setLoading] = useState<Provider | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = (provider: Provider) => {
    setLoading(provider)
    setError(null)

    setTimeout(() => {
      if (provider === "email") {
        setError("Email login failed. Try again.")
        setLoading(null)
        return
      }

      setUser(provider + "@user.com")
      setLoading(null)
    }, 1200)
  }

  const handleLogout = () => {
    setUser(null)
  }

  if (user) {
    return (
      <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 space-y-3">
        <p className="text-sm text-neutral-400">Signed in as</p>
        <p className="font-semibold">{user}</p>

        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-400 px-3 py-2 rounded-md text-sm"
        >
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-semibold">Sign in</h3>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      <button
        onClick={() => handleLogin("google")}
        className="w-full bg-white text-black py-2 rounded-md"
        disabled={loading !== null}
      >
        {loading === "google" ? "Connecting..." : "Continue with Google"}
      </button>

      <button
        onClick={() => handleLogin("github")}
        className="w-full bg-gray-900 border border-gray-700 py-2 rounded-md"
        disabled={loading !== null}
      >
        {loading === "github" ? "Connecting..." : "Continue with GitHub"}
      </button>

      <button
        onClick={() => handleLogin("email")}
        className="w-full bg-blue-600 py-2 rounded-md"
        disabled={loading !== null}
      >
        {loading === "email" ? "Connecting..." : "Continue with Email"}
      </button>
    </div>
  )
}