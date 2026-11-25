/**
 * Keeper Service Layer
 * 
 * Handles all API calls, error handling, retry logic, and data fetching for the Keeper system.
 * Implements fault-tolerant patterns and graceful degradation.
 */

import {
  Keeper,
  KeeperListResponse,
  KeeperDetailResponse,
  KeeperStatistics,
  KeeperUpdatePayload,
  ActionResponse,
  KeeperAPIRequest,
  KeeperError,
  Execution,
  KeeperUpdateMessage,
} from '@/types/keeper';
import {
  createKeeperError,
  calculateRetryAfter,
  logKeeperError,
  validateKeeperData,
  sanitizeKeeperData,
  shouldRetry,
} from './errors';

/**
 * Configuration for API requests
 */
interface FetchOptions extends RequestInit {
  timeout?: number;
  retryCount?: number;
  useCache?: boolean;
  cacheKey?: string;
}

/**
 * In-memory cache for keeper data
 */
const dataCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Base URL for API (can be configured per environment)
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export type KeeperEventChannel = KeeperUpdateMessage['type'] | 'all';
export type KeeperEventHandler = (message: KeeperUpdateMessage) => void;

export interface KeeperWebSocketMultiplexerOptions {
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

type KeeperSubscriptionMessage = {
  type: 'subscribe' | 'unsubscribe';
  channels: KeeperUpdateMessage['type'][];
};

/**
 * Make a resilient fetch request with retry logic and timeout
 */
async function fetchWithRetry<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const {
    timeout = 10000,
    retryCount = 0,
    useCache = true,
    cacheKey,
    ...fetchOptions
  } = options;

  const url = `${API_BASE_URL}${endpoint}`;
  const key = cacheKey || endpoint;

  // Check cache first
  if (useCache && fetchOptions.method !== 'POST' && fetchOptions.method !== 'PATCH') {
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { ...(cached.data as T), __cached: true } as T;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    });

    clearTimeout(timeoutId);

    // Handle non-OK responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createKeeperError(
        new Error(errorData.message || `HTTP ${response.status}`),
        {
          endpoint,
          method: fetchOptions.method,
          responseStatus: response.status,
          responseData: errorData,
          retryCount,
        }
      );
    }

    const data = await response.json();

    // Cache successful responses
    if (useCache && fetchOptions.method !== 'POST' && fetchOptions.method !== 'PATCH') {
      dataCache.set(key, {
        data,
        timestamp: Date.now(),
      });
    }

    return data as T;
  } catch (error) {
    let keeperError: KeeperError;

    if (error && typeof error === 'object' && 'type' in error && 'retriable' in error) {
      keeperError = error as KeeperError;
    } else {
      keeperError = createKeeperError(error, {
        endpoint,
        method: fetchOptions.method,
        retryCount,
      });
    }

    logKeeperError(keeperError);

    // Implement retry logic
    if (shouldRetry(keeperError, retryCount)) {
      const delay = calculateRetryAfter(retryCount);
      await new Promise((resolve) => setTimeout(resolve, delay));

      return fetchWithRetry<T>(endpoint, {
        ...options,
        retryCount: retryCount + 1,
      });
    }

    throw keeperError;
  }
}

/**
 * Keeper Service Object
 * All API methods for keeper management
 */
export const keeperService = {
  /**
   * Fetch all keepers with pagination and filtering
   */
  async fetchKeepers(params?: KeeperAPIRequest): Promise<KeeperListResponse> {
    const queryParams = new URLSearchParams();

    if (params) {
      if (params.page !== undefined) queryParams.append('page', String(params.page));
      if (params.limit !== undefined) queryParams.append('limit', String(params.limit));
      if (params.status?.length) queryParams.append('status', params.status.join(','));
      if (params.region?.length) queryParams.append('region', params.region.join(','));
      if (params.sortBy) queryParams.append('sortBy', params.sortBy);
      if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder);
      if (params.search) queryParams.append('search', params.search);
    }

    const query = queryParams.toString();
    const endpoint = `/keeper${query ? `?${query}` : ''}`;

    try {
      const response = await fetchWithRetry<KeeperListResponse>(endpoint, {
        method: 'GET',
        useCache: true,
      });

      // Validate and sanitize keeper data
      response.data = response.data.map((keeper) => {
        if (!validateKeeperData(keeper)) {
          console.warn('Invalid keeper data received:', keeper);
        }
        return sanitizeKeeperData(keeper);
      }) as Keeper[];

      return response;
    } catch (error) {
      logKeeperError(error as KeeperError, { endpoint: `/keeper` });
      throw error;
    }
  },

  /**
   * Fetch a single keeper's details
   */
  async fetchKeeperDetail(keeperId: string): Promise<KeeperDetailResponse> {
    const endpoint = `/keeper/${keeperId}`;

    try {
      const response = await fetchWithRetry<KeeperDetailResponse>(endpoint, {
        method: 'GET',
        useCache: true,
        cacheKey: `keeper-${keeperId}`,
      });

      // Validate keeper data
      if (!validateKeeperData(response.data)) {
        console.warn('Invalid keeper detail data:', response.data);
      }

      response.data = sanitizeKeeperData(response.data) as Keeper;
      return response;
    } catch (error) {
      logKeeperError(error as KeeperError, { keeperId });
      throw error;
    }
  },

  /**
   * Fetch keeper metrics
   */
  async fetchKeeperMetrics(keeperId: string): Promise<Keeper['metrics']> {
    const endpoint = `/keeper/${keeperId}/metrics`;

    try {
      return await fetchWithRetry<Keeper['metrics']>(endpoint, {
        method: 'GET',
        useCache: true,
        cacheKey: `metrics-${keeperId}`,
        timeout: 8000,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, { keeperId });
      throw error;
    }
  },

  /**
   * Fetch recent executions for a keeper
   */
  async fetchKeeperExecutions(
    keeperId: string,
    limit: number = 50
  ): Promise<Execution[]> {
    const endpoint = `/keeper/${keeperId}/executions?limit=${limit}`;

    try {
      return await fetchWithRetry<Execution[]>(endpoint, {
        method: 'GET',
        useCache: true,
        cacheKey: `executions-${keeperId}`,
        timeout: 8000,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, { keeperId });
      throw error;
    }
  },

  /**
   * Fetch aggregate keeper statistics
   */
  async fetchKeeperStats(): Promise<KeeperStatistics> {
    const endpoint = '/keeper/stats';

    try {
      return await fetchWithRetry<KeeperStatistics>(endpoint, {
        method: 'GET',
        useCache: true,
        cacheKey: 'keeper-stats',
        timeout: 8000,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, { endpoint });
      throw error;
    }
  },

  /**
   * Update keeper configuration
   */
  async updateKeeperConfig(
    keeperId: string,
    payload: KeeperUpdatePayload
  ): Promise<ActionResponse> {
    const endpoint = `/keeper/${keeperId}`;

    try {
      // Invalidate cache after update
      dataCache.delete(`keeper-${keeperId}`);

      return await fetchWithRetry<ActionResponse>(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        useCache: false,
        timeout: 10000,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, {
        keeperId,
        requestData: payload,
      });
      throw error;
    }
  },

  /**
   * Pause a keeper
   */
  async pauseKeeper(keeperId: string): Promise<ActionResponse> {
    const endpoint = `/keeper/${keeperId}/pause`;

    try {
      dataCache.delete(`keeper-${keeperId}`);

      return await fetchWithRetry<ActionResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify({}),
        useCache: false,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, { keeperId });
      throw error;
    }
  },

  /**
   * Resume a paused keeper
   */
  async resumeKeeper(keeperId: string): Promise<ActionResponse> {
    const endpoint = `/keeper/${keeperId}/resume`;

    try {
      dataCache.delete(`keeper-${keeperId}`);

      return await fetchWithRetry<ActionResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify({}),
        useCache: false,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, { keeperId });
      throw error;
    }
  },

  /**
   * Restart a keeper
   */
  async restartKeeper(keeperId: string): Promise<ActionResponse> {
    const endpoint = `/keeper/${keeperId}/restart`;

    try {
      dataCache.delete(`keeper-${keeperId}`);

      return await fetchWithRetry<ActionResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify({}),
        useCache: false,
      });
    } catch (error) {
      logKeeperError(error as KeeperError, { keeperId });
      throw error;
    }
  },

  /**
   * Clear the cache
   */
  clearCache(): void {
    dataCache.clear();
  },

  /**
   * Get cache stats for debugging
   */
  getCacheStats(): {
    size: number;
    entries: string[];
  } {
    return {
      size: dataCache.size,
      entries: Array.from(dataCache.keys()),
    };
  },
};

function isKeeperEventChannel(value: unknown): value is KeeperUpdateMessage['type'] {
  return (
    value === 'keeper-status' ||
    value === 'keeper-metrics' ||
    value === 'keeper-execution' ||
    value === 'keeper-error'
  );
}

function isKeeperUpdateMessage(value: unknown): value is KeeperUpdateMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const message = value as Partial<KeeperUpdateMessage>;
  return (
    isKeeperEventChannel(message.type) &&
    typeof message.keeperId === 'string' &&
    typeof message.timestamp === 'string' &&
    'data' in message
  );
}

/**
 * Multiplexes keeper update channels over one resilient WebSocket connection.
 */
export class KeeperWebSocketMultiplexer {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly url: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly handlers = new Map<KeeperEventChannel, Set<KeeperEventHandler>>();
  private reconnectAttempts = 0;
  private manualClose = false;

  constructor(options: KeeperWebSocketMultiplexerOptions = {}) {
    this.url =
      options.url || `${API_BASE_URL.replace(/^http/, 'ws')}/ws/keeper/updates`;
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
  }

  connect(): Promise<void> {
    if (this.isConnected()) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.manualClose = false;
    this.connectPromise = new Promise((resolve, reject) => {
      try {
        const ws = new this.WebSocketImpl(this.url);
        this.ws = ws;

        ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.connectPromise = null;
          this.sendSubscribedChannels();
          resolve();
        };

        ws.onmessage = (event) => {
          this.handleRawMessage(event.data);
        };

        ws.onerror = (error) => {
          if (this.connectPromise) {
            this.connectPromise = null;
            reject(error);
          }
          console.error('[Keeper WS] Multiplexer error:', error);
        };

        ws.onclose = () => {
          this.connectPromise = null;
          this.ws = null;
          if (!this.manualClose) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        this.connectPromise = null;
        reject(error);
      }
    });

    return this.connectPromise;
  }

  subscribe(channel: KeeperEventChannel, handler: KeeperEventHandler): () => void {
    const handlers = this.handlers.get(channel) ?? new Set<KeeperEventHandler>();
    const hadSubscribers = handlers.size > 0;
    handlers.add(handler);
    this.handlers.set(channel, handlers);

    if (!hadSubscribers && channel !== 'all' && this.isConnected()) {
      this.sendSubscription('subscribe', [channel]);
    }

    return () => {
      this.unsubscribe(channel, handler);
    };
  }

  unsubscribe(channel: KeeperEventChannel, handler: KeeperEventHandler): void {
    const handlers = this.handlers.get(channel);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size > 0) {
      return;
    }

    this.handlers.delete(channel);
    if (channel !== 'all' && this.isConnected()) {
      this.sendSubscription('unsubscribe', [channel]);
    }
  }

  disconnect(): void {
    this.manualClose = true;
    this.connectPromise = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === this.WebSocketImpl.OPEN;
  }

  getSubscriptionCount(channel?: KeeperEventChannel): number {
    if (channel) {
      return this.handlers.get(channel)?.size ?? 0;
    }

    return Array.from(this.handlers.values()).reduce(
      (count, handlers) => count + handlers.size,
      0,
    );
  }

  private handleRawMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn('[Keeper WS] Ignoring malformed message:', error);
      return;
    }

    if (!isKeeperUpdateMessage(parsed)) {
      console.warn('[Keeper WS] Ignoring invalid keeper update:', parsed);
      return;
    }

    this.dispatch(parsed);
  }

  private dispatch(message: KeeperUpdateMessage): void {
    const channelHandlers = this.handlers.get(message.type) ?? new Set();
    const allHandlers = this.handlers.get('all') ?? new Set();

    for (const handler of [...channelHandlers, ...allHandlers]) {
      try {
        handler(message);
      } catch (error) {
        console.error('[Keeper WS] Keeper update handler failed:', error);
      }
    }
  }

  private sendSubscribedChannels(): void {
    const channels = this.getServerChannels();
    if (channels.length > 0) {
      this.sendSubscription('subscribe', channels);
    }
  }

  private getServerChannels(): KeeperUpdateMessage['type'][] {
    return Array.from(this.handlers.keys()).filter(
      (channel): channel is KeeperUpdateMessage['type'] => channel !== 'all',
    );
  }

  private sendSubscription(
    type: KeeperSubscriptionMessage['type'],
    channels: KeeperUpdateMessage['type'][],
  ): void {
    if (!this.isConnected() || channels.length === 0) {
      return;
    }

    const message: KeeperSubscriptionMessage = { type, channels };
    this.ws?.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Keeper WS] Multiplexer reconnect attempts exhausted');
      return;
    }

    const baseDelay = Math.min(
      this.maxReconnectDelayMs,
      this.reconnectDelayMs * 2 ** this.reconnectAttempts,
    );
    const jitter = Math.floor(Math.random() * Math.min(500, baseDelay));
    this.reconnectAttempts += 1;

    setTimeout(() => {
      if (!this.manualClose && this.getServerChannels().length > 0) {
        this.connect().catch((error) => {
          console.error('[Keeper WS] Multiplexer reconnect failed:', error);
        });
      }
    }, baseDelay + jitter);
  }
}

/**
 * WebSocket connection handler for real-time updates
 */
export class KeeperWebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers: ((message: unknown) => void)[] = [];
  private isManualClose = false;

  constructor(url?: string) {
    this.url = url || `${API_BASE_URL.replace(/^http/, 'ws')}/ws/keeper/updates`;
  }

  /**
   * Connect to WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[Keeper WS] Connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.messageHandlers.forEach((handler) => handler(message));
          } catch (error) {
            console.error('[Keeper WS] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Keeper WS] Error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[Keeper WS] Closed');
          if (!this.isManualClose) {
            this.attemptReconnect();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Keeper WS] Max reconnect attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`[Keeper WS] Attempting to reconnect in ${delay}ms...`);

    setTimeout(() => {
      if (!this.isManualClose) {
        this.connect().catch((error) => {
          console.error('[Keeper WS] Reconnect failed:', error);
        });
      }
    }, delay);
  }

  /**
   * Subscribe to messages
   */
  onMessage(handler: (message: unknown) => void): () => void {
    this.messageHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.isManualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
