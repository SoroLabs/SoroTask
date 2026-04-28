const http = require('http');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4100;
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Future Network ; October 2022';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLatestLedger(ledger = {}) {
  if (typeof ledger === 'number') {
    return { sequence: ledger };
  }

  return {
    sequence: ledger.sequence ?? 1,
    protocolVersion: ledger.protocolVersion ?? 20,
    id: ledger.id ?? 'mock-ledger',
    ...ledger,
  };
}

function normalizeAccount(accountId, account = {}) {
  const sequence = String(
    account.sequence ??
      account.sequenceNumber ??
      account.seqNum ??
      '1',
  );

  return {
    accountId,
    sequence,
    balances: account.balances ?? [{ asset_type: 'native', balance: '1000.0000000' }],
    ...account,
  };
}

function getPrimaryParams(params) {
  if (Array.isArray(params)) {
    return params[0] ?? {};
  }

  return params ?? {};
}

class MockSorobanRpcServer {
  constructor(options = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.health = options.health ?? { status: 'healthy' };
    this.network = {
      passphrase: options.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE,
      protocolVersion: options.protocolVersion ?? 20,
      friendbotUrl: options.friendbotUrl ?? null,
    };
    this.latestLedger = normalizeLatestLedger(options.latestLedger);
    this.events = clone(options.events ?? []);
    this.defaultSimulationResponse = clone(
      options.defaultSimulationResponse ?? { results: [] },
    );
    this.simulationQueue = clone(options.simulationQueue ?? []);
    this.accounts = new Map();
    this.server = null;

    const accounts = options.accounts ?? {};
    Object.entries(accounts).forEach(([accountId, account]) => {
      this.setAccount(accountId, account);
    });
  }

  async start() {
    if (this.server?.listening) {
      return this.getUrl();
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        this.writeJson(res, 500, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: error.message,
          },
        });
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    return this.getUrl();
  }

  async stop() {
    if (!this.server) {
      return;
    }

    if (!this.server.listening) {
      this.server = null;
      return;
    }

    await new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.server = null;
  }

  getUrl() {
    const address = this.server?.address();
    const port =
      typeof address === 'object' && address?.port ? address.port : this.port;
    return `http://${this.host}:${port}`;
  }

  setHealth(health) {
    this.health = clone(health);
  }

  setNetworkPassphrase(passphrase) {
    this.network.passphrase = passphrase;
  }

  setLatestLedger(ledger) {
    this.latestLedger = normalizeLatestLedger(ledger);
  }

  setEvents(events) {
    this.events = clone(events);
  }

  setAccount(accountId, account) {
    this.accounts.set(accountId, normalizeAccount(accountId, account));
  }

  setDefaultSimulationResponse(response) {
    this.defaultSimulationResponse = clone(response);
  }

  queueSimulationResponse(response) {
    this.simulationQueue.push(clone(response));
  }

  async handleRequest(req, res) {
    if (req.method !== 'POST') {
      this.writeJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const body = await this.readBody(req);
    const payload = JSON.parse(body || '{}');

    if (!payload.method) {
      this.writeJson(res, 400, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC request',
        },
      });
      return;
    }

    try {
      const result = this.dispatch(payload.method, payload.params);
      this.writeJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        result,
      });
    } catch (error) {
      this.writeJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id ?? null,
        error: {
          code: error.code ?? -32000,
          message: error.message,
        },
      });
    }
  }

  dispatch(method, params) {
    switch (method) {
    case 'getHealth':
      return clone(this.health);
    case 'getNetwork':
      return clone(this.network);
    case 'getLatestLedger':
      return clone(this.latestLedger);
    case 'getEvents':
      return this.getEvents(params);
    case 'getAccount':
      return this.getAccount(params);
    case 'simulateTransaction':
      return this.simulateTransaction();
    case 'sendTransaction':
      return this.sendTransaction(params);
    case 'getTransaction':
      return this.getTransaction(params);
    default: {
      const error = new Error(`Unsupported mock RPC method: ${method}`);
      error.code = -32601;
      throw error;
    }
    }
  }

  getEvents(params) {
    const options = getPrimaryParams(params);
    const startLedger = options.startLedger ?? 0;
    const cursor = options.cursor ?? null;
    const limit = options.limit ?? 100;

    let filtered = this.events.filter((event) => (event.ledger ?? 0) >= startLedger);

    if (cursor) {
      const cursorIndex = filtered.findIndex((event) => {
        const pagingToken = String(
          event.pagingToken ?? event.id ?? event.ledger ?? '',
        );
        return pagingToken === String(cursor);
      });

      if (cursorIndex >= 0) {
        filtered = filtered.slice(cursorIndex + 1);
      }
    }

    const events = filtered.slice(0, limit).map((event, index) => ({
      pagingToken:
        event.pagingToken ??
        `${event.ledger ?? startLedger}-${index + 1}`,
      ...clone(event),
    }));

    const hasMore = filtered.length > limit;
    const nextCursor = hasMore ? events[events.length - 1].pagingToken : null;

    return {
      events,
      latestLedger: this.latestLedger.sequence,
      cursor: nextCursor,
    };
  }

  getAccount(params) {
    const options = getPrimaryParams(params);
    const accountId =
      (typeof options === 'string' && options) ||
      options.accountId ||
      options.address ||
      options.publicKey;

    if (!accountId) {
      const error = new Error('Missing account identifier');
      error.code = -32602;
      throw error;
    }

    if (!this.accounts.has(accountId)) {
      const error = new Error(`Unknown mock account: ${accountId}`);
      error.code = -32004;
      throw error;
    }

    return clone(this.accounts.get(accountId));
  }

  simulateTransaction() {
    if (this.simulationQueue.length > 0) {
      return clone(this.simulationQueue.shift());
    }

    return clone(this.defaultSimulationResponse);
  }

  sendTransaction(params) {
    return {
      status: 'PENDING',
      hash: 'mock-tx-hash-' + Date.now() + '-' + Math.floor(Math.random() * 1000000)
    };
  }

  getTransaction(params) {
    return {
      status: 'SUCCESS',
      latestLedger: this.latestLedger.sequence,
      latestLedgerCloseTime: Date.now(),
      oldestLedger: 1,
      oldestLedgerCloseTime: 0
    };
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify(payload));
  }
}

module.exports = {
  MockSorobanRpcServer,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_NETWORK_PASSPHRASE,
};
