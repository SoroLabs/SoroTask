const request = require('supertest');
const { createServer } = require('./server');

describe('strict OpenAPI request validation', () => {
  test('rejects unknown request properties with RFC 7807', async () => {
    const { app } = createServer();
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
    const { app } = createServer();
    const response = await request(app).post('/verify-proof').send({
      taskId: 'not-an-integer',
      circuitId: 'circuit',
      taskCondition: { type: 'threshold', params: {} },
      proof: { proofId: 'bad', pi_a: [], pi_b: [], pi_c: [], publicSignals: [] },
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
  });
});
