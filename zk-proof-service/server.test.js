const request = require('supertest');
const { createServer } = require('./server');

describe('strict OpenAPI request validation', () => {
  test('rejects unknown request properties with RFC 7807', async () => {
    const { app } = await createServer({ skipAttestation: true });
    const response = await request(app).post('/generate-proof').send({
      taskId: 1,
      circuitId: 'circuit',
      taskCondition: { type: 'threshold', params: {} },
      clientData: { witness: { value: 1 } },
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toEqual(expect.objectContaining({
      type: expect.stringMatching(/^https:\/\//),
      title: expect.any(String),
      status: 400,
      detail: expect.any(String),
    }));
  });

  test('rejects malformed types before reaching the handler', async () => {
    const { app } = await createServer({ skipAttestation: true });
    const response = await request(app).post('/verify-proof').send({
      taskId: 'not-an-integer',
      circuitId: 'circuit',
      taskCondition: { type: 'threshold', params: {} },
      proof: { proofId: 'bad', pi_a: [], pi_b: [], pi_c: [], publicSignals: [] },
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  test('POST /generate-proof enforces 10 req/min rate limit per IP and returns HTTP 429 with Retry-After header', async () => {
    const mockZkService = {
      isReady: true,
      getWorkerPoolStatus: () => ({ totalWorkers: 4, activeWorkers: 0, idleWorkers: 4 }),
      generateProof: async () => ({
        proofId: 'test-proof-1',
        pi_a: ['0x01', '0x02'],
        pi_b: [['0x03', '0x04'], ['0x05', '0x06']],
        pi_c: ['0x07', '0x08'],
        publicSignals: ['0x09'],
      }),
      enqueueAsyncJob: () => ({ jobId: 'job-1', status: 'queued', createdAt: new Date().toISOString() }),
    };
    const { app } = await createServer({ zkService: mockZkService, skipAttestation: true });
    const payload = {
      taskId: 1,
      circuitId: 'liquidity-threshold-v1',
      taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 100 } },
      clientData: { witness: { actualLiquidity: 500 } },
    };

    // Send 10 valid requests
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/generate-proof').send(payload);
      expect([200, 202]).toContain(res.status);
    }

    // 11th request must be rate limited with 429 Too Many Requests
    const rateLimitedRes = await request(app).post('/generate-proof').send(payload);
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.headers['retry-after']).toBeDefined();
    expect(rateLimitedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  test('POST /generate-proof/plonk and /verify-proof/plonk handle PLONK scheme proof generation and verification', async () => {
    const mockZkService = {
      isReady: true,
      getWorkerPoolStatus: () => ({ totalWorkers: 4, activeWorkers: 0, idleWorkers: 4 }),
      generateProof: async () => ({
        proofId: 'test-plonk-1',
        pi_a: ['0x01', '0x02'],
        pi_b: [['0x03', '0x04'], ['0x05', '0x06']],
        pi_c: ['0x07', '0x08'],
        publicSignals: ['0x09'],
      }),
    };
    const { app } = await createServer({ zkService: mockZkService, skipAttestation: true });
    const payload = {
      taskId: 1,
      circuitId: 'plonk-circuit-v1',
      taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 100 } },
      clientData: { witness: { actualLiquidity: 500 } },
    };

    const genRes = await request(app).post('/generate-proof/plonk').send(payload);
    expect(genRes.status).toBe(200);
    expect(genRes.body.provingScheme).toBe('plonk');
    expect(genRes.body.srs).toBe('universal-srs-21-powers');

    const verifyRes = await request(app).post('/verify-proof/plonk').send({
      taskId: 1,
      circuitId: 'plonk-circuit-v1',
      taskCondition: payload.taskCondition,
      proof: genRes.body.proof,
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
    expect(verifyRes.body.provingScheme).toBe('plonk');
  });

  test('POST /proofs/async returns 202 with an immediate job_id and queued status', async () => {
    const { EventEmitter } = require('events');
    const zkService = new EventEmitter();
    zkService.isReady = true;
    zkService.initialize = () => {};
    zkService.getWorkerPoolStatus = () => ({ totalWorkers: 4, activeWorkers: 0, idleWorkers: 4 });
    zkService.enqueueAsyncJob = () => ({ jobId: 'job-abc', status: 'queued', createdAt: new Date().toISOString() });
    zkService.getAsyncJob = async () => null;
    zkService.proofCache = { get: async () => null, set: async () => {}, close: async () => {} };
    zkService.proverQueue = { close: async () => {} };

    const { app } = await createServer({ zkService, skipAttestation: true, skipInitialize: true });
    const res = await request(app).post('/proofs/async').send({
      taskId: 1,
      circuitId: 'liquidity-threshold-v1',
      taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 100 } },
      clientData: { witness: { actualLiquidity: 500 } },
    });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe('job-abc');
    expect(res.body.status).toBe('queued');
  });

  test('GET /proofs/:job_id/stream pushes progress then the final proof payload over SSE', async () => {
    const { EventEmitter } = require('events');
    const zkService = new EventEmitter();
    zkService.isReady = true;
    zkService.initialize = () => {};
    zkService.getWorkerPoolStatus = () => ({ totalWorkers: 4, activeWorkers: 0, idleWorkers: 4 });

    const job = {
      jobId: 'job-sse',
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    zkService.getAsyncJob = async () => job;
    zkService.enqueueAsyncJob = () => ({ jobId: 'job-sse', status: 'queued', createdAt: job.createdAt });
    zkService.proofCache = { get: async () => null, set: async () => {}, close: async () => {} };
    zkService.proverQueue = { close: async () => {} };

    const { app } = await createServer({ zkService, skipAttestation: true, skipInitialize: true });

    setTimeout(() => {
      job.status = 'processing';
      job.progress = 55;
      zkService.emit('jobProgress', { jobId: 'job-sse', status: 'processing', progress: 55 });
    }, 20);
    setTimeout(() => {
      job.status = 'completed';
      job.progress = 100;
      job.result = {
        proofId: 'proof-sse',
        status: 'success',
        conditionHash: '0xabc123',
        proof: { pi_a: [], pi_b: [], pi_c: [], publicSignals: [] },
      };
      zkService.emit('jobComplete', job);
    }, 70);

    const res = await request(app).get('/proofs/job-sse/stream');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: status');
    expect(res.text).toContain('"status":"queued"');
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('"progress":55');
    expect(res.text).toContain('event: complete');
    expect(res.text).toContain('"proofId":"proof-sse"');
  });

  test('rejects malformed POST /proofs/async body with RFC 7807 before reaching the handler', async () => {
    const mockZkService = {
      isReady: true,
      getWorkerPoolStatus: () => ({ totalWorkers: 4, activeWorkers: 0, idleWorkers: 4 }),
    };
    const { app } = await createServer({ zkService: mockZkService, skipAttestation: true });
    const res = await request(app).post('/proofs/async').send({
      taskId: 'not-an-integer',
      hello: 'world',
    });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });
});
