import { EdgeCachingStrategyEngine } from '../edge-caching';

function makeResponse(body: string, status = 200, type: ResponseType = 'basic'): Response {
  const res = new Response(body, { status });
  Object.defineProperty(res, 'type', { value: type });
  return res;
}

function buildMockCache(
  stored: Map<string, Response> = new Map(),
): jest.Mocked<Cache> {
  return {
    match: jest.fn(async (req: RequestInfo) => {
      const url = typeof req === 'string' ? req : (req as Request).url;
      return stored.get(url) ?? undefined;
    }),
    put: jest.fn(async (req: RequestInfo, res: Response) => {
      const url = typeof req === 'string' ? req : (req as Request).url;
      stored.set(url, res);
    }),
    delete: jest.fn(async () => true),
    keys: jest.fn(async () =>
      [...stored.keys()].map((url) => new Request(url)),
    ),
    add: jest.fn(),
    addAll: jest.fn(),
    matchAll: jest.fn(),
  } as unknown as jest.Mocked<Cache>;
}

describe('EdgeCachingStrategyEngine', () => {
  let engine: EdgeCachingStrategyEngine;
  let mockCachesOpen: jest.Mock;

  beforeEach(() => {
    mockCachesOpen = jest.fn();

    Object.defineProperty(global, 'caches', {
      value: { open: mockCachesOpen },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(global, 'Request', {
      value: class MockRequest {
        url: string;
        method: string;
        constructor(url: string, init?: RequestInit) {
          this.url = url;
          this.method = (init?.method as string) ?? 'GET';
        }
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(global, 'Response', {
      value: class MockResponse {
        private body: string;
        ok: boolean;
        status: number;
        type: ResponseType;
        headers: { 'Content-Type'?: string };

        constructor(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
          this.body = body;
          this.status = init.status ?? 200;
          this.ok = this.status >= 200 && this.status < 300;
          this.type = 'basic';
          this.headers = init.headers ?? {};
        }

        async text() { return this.body; }
        async json() { return JSON.parse(this.body); }
        clone() {
          const cloned = new (global.Response as any)(this.body, { status: this.status, headers: this.headers });
          cloned.type = this.type;
          return cloned;
        }
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('constructs with default options without throwing', () => {
      expect(() => new EdgeCachingStrategyEngine()).not.toThrow();
    });

    it('accepts custom cacheName and maxItems', () => {
      expect(
        () =>
          new EdgeCachingStrategyEngine({
            cacheName: 'custom-cache',
            maxItems: 50,
          }),
      ).not.toThrow();
    });

    it('throws when maxItems is less than 1', () => {
      expect(() => new EdgeCachingStrategyEngine({ maxItems: 0 })).toThrow(
        /maxItems must be at least 1/,
      );
    });
  });

  describe('initialize', () => {
    it('calls caches.open with the configured cache name', async () => {
      const mockCache = buildMockCache();
      mockCachesOpen.mockResolvedValue(mockCache);

      engine = new EdgeCachingStrategyEngine({ cacheName: 'test-cache' });
      await engine.initialize();

      expect(mockCachesOpen).toHaveBeenCalledWith('test-cache');
    });
  });

  describe('handleRequest — cache hit (Stale-While-Revalidate)', () => {
    it('returns cached response immediately', async () => {
      const stored = new Map<string, Response>();
      stored.set('http://sorotask.app/api/tasks', makeResponse('{"tasks":[]}'));
      const mockCache = buildMockCache(stored);
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockResolvedValue(makeResponse('{"tasks":[1]}'));

      engine = new EdgeCachingStrategyEngine();
      await engine.initialize();

      const response = await engine.handleRequest(
        new Request('http://sorotask.app/api/tasks'),
      );

      const text = await response.text();
      expect(text).toBe('{"tasks":[]}');
    });

    it('triggers a background network revalidation on a cache hit', async () => {
      const stored = new Map<string, Response>();
      stored.set('http://sorotask.app/api/tasks', makeResponse('stale'));
      const mockCache = buildMockCache(stored);
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockResolvedValue(makeResponse('fresh'));

      engine = new EdgeCachingStrategyEngine();
      await engine.initialize();

      await engine.handleRequest(new Request('http://sorotask.app/api/tasks'));
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleRequest — cache miss (network fetch)', () => {
    it('fetches from the network and stores the response', async () => {
      const mockCache = buildMockCache();
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockResolvedValue(makeResponse('{"tasks":[]}'));

      engine = new EdgeCachingStrategyEngine();
      await engine.initialize();

      await engine.handleRequest(new Request('http://sorotask.app/api/tasks'));

      expect(mockCache.put).toHaveBeenCalled();
    });

    it('does not cache non-200 responses', async () => {
      const mockCache = buildMockCache();
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockResolvedValue(makeResponse('error', 404));

      engine = new EdgeCachingStrategyEngine();
      await engine.initialize();

      await engine.handleRequest(new Request('http://sorotask.app/api/missing'));

      expect(mockCache.put).not.toHaveBeenCalled();
    });
  });

  describe('handleRequest — offline fallback', () => {
    it('returns a 503 fallback when both cache and network are unavailable', async () => {
      const mockCache = buildMockCache();
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      engine = new EdgeCachingStrategyEngine();
      await engine.initialize();

      const response = await engine.handleRequest(
        new Request('http://sorotask.app/api/tasks'),
      );

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe('Service Unavailable');
    });

    it('returns stale cached response when network fails but cache has a copy', async () => {
      const stale = makeResponse('cached-fallback');
      let callCount = 0;
      const mockCache = buildMockCache();
      mockCache.match = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return undefined;
        return stale;
      });
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      engine = new EdgeCachingStrategyEngine();
      await engine.initialize();

      const response = await engine.handleRequest(
        new Request('http://sorotask.app/api/tasks'),
      );
      const text = await response.text();
      expect(text).toBe('cached-fallback');
    });
  });

  describe('cache eviction (enforceLimit)', () => {
    it('evicts oldest entries when maxItems is exceeded', async () => {
      const stored = new Map<string, Response>();
      for (let i = 0; i < 5; i++) {
        stored.set(`http://sorotask.app/item-${i}`, makeResponse(`item-${i}`));
      }

      const mockCache = buildMockCache(stored);
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockResolvedValue(makeResponse('new-item'));

      engine = new EdgeCachingStrategyEngine({ maxItems: 3 });
      await engine.initialize();

      await engine.handleRequest(new Request('http://sorotask.app/new-item'));

      expect(mockCache.delete).toHaveBeenCalled();
    });

    it('does not evict when under the limit', async () => {
      const mockCache = buildMockCache();
      mockCachesOpen.mockResolvedValue(mockCache);

      global.fetch = jest.fn().mockResolvedValue(makeResponse('ok'));

      engine = new EdgeCachingStrategyEngine({ maxItems: 250 });
      await engine.initialize();

      await engine.handleRequest(new Request('http://sorotask.app/item'));

      expect(mockCache.delete).not.toHaveBeenCalled();
    });
  });

  describe('handleRequest — without initialization', () => {
    it('falls through to fetch directly when cache is not initialized', async () => {
      global.fetch = jest.fn().mockResolvedValue(makeResponse('direct'));

      engine = new EdgeCachingStrategyEngine();

      const response = await engine.handleRequest(
        new Request('http://sorotask.app/api/tasks'),
      );

      const text = await response.text();
      expect(text).toBe('direct');
    });
  });
});
