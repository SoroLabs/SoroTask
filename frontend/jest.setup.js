require('@testing-library/jest-dom')
const React = require('react')

if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}

// jsdom doesn't expose structuredClone, which fake-indexeddb relies on.
if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value))
}

if (typeof global.fetch !== 'function') {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        riskScore: 18,
        riskLevel: 'low',
        confidence: 'high',
        summary: 'Low risk predicted by test fallback.',
        evidence: {
          gasShortfall: false,
          intervalTooFast: false,
          contractReputation: 'Mock fallback prediction executed.',
        },
      } ),
    })
  )
}

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  SessionProvider: ({ children }) => children,
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signIn: jest.fn(),
  signOut: jest.fn(),
}))

// Mock environment variables for tests
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000'
process.env.NEXT_PUBLIC_SENTRY_DSN = '' // Disable Sentry in tests by default

// Mock Sentry
jest.mock('@sentry/nextjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  setExtra: jest.fn(),
  setTag: jest.fn(),
  startTransaction: jest.fn(() => ({
    setTag: jest.fn(),
    setExtra: jest.fn(),
    setData: jest.fn(),
    finish: jest.fn(),
  })),
}))

jest.mock('@sentry/react', () => ({
  ErrorBoundary: ({ children }) => children,
  withProfiler: (Component) => Component,
}))

// Mock scrollIntoView for jsdom (used by ZKProofLogStream)
Element.prototype.scrollIntoView = jest.fn()

// Suppress known Tiptap duplicate-extension warning in tests
const originalWarn = console.warn.bind(console)
beforeAll(() => {
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Duplicate extension')) return
    originalWarn(...args)
  }
})
afterAll(() => {
  console.warn = originalWarn
})

// Mock Next.js navigation (App Router)
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      prefetch: jest.fn(),
    }
  },
  usePathname() {
    return '/'
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  useParams() {
    return {}
  },
  redirect: jest.fn(),
  notFound: jest.fn(),
}))

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      prefetch: jest.fn(),
    }
  },
  usePathname() {
    return '/'
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  useParams() {
    return {}
  },
  redirect: jest.fn(),
  notFound: jest.fn(),
}))

// Mock Next.js Image component to avoid next/image optimisation in tests.
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  default: ({ priority: _priority, ...props }) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />
  },
}))
