import '@testing-library/jest-dom'

// Mock environment variables for tests
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000'

// The project uses the Next.js App Router (app/ directory).
// App Router uses next/navigation — NOT next/router (which is Pages Router only).
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

// Mock Next.js Image component to avoid next/image optimisation in tests.
jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line jsx-a11y/alt-text
  default: (props) => <img {...props} />,
}))
