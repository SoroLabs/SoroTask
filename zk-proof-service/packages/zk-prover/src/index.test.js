'use strict';

const { shouldUseFallback, generateProofViaBackend, generateProof } = require('./index');

describe('shouldUseFallback', () => {
  it('falls back when WebAssembly is unavailable', () => {
    const realWebAssembly = global.WebAssembly;
    delete global.WebAssembly;
    try {
      expect(shouldUseFallback({ nav: {} })).toBe(true);
    } finally {
      global.WebAssembly = realWebAssembly;
    }
  });

  it('falls back when reported device memory is below the threshold', () => {
    expect(shouldUseFallback({ nav: { deviceMemory: 2 }, minDeviceMemoryGb: 4 })).toBe(true);
  });

  it('does not fall back when device memory meets the threshold', () => {
    expect(shouldUseFallback({ nav: { deviceMemory: 8 }, minDeviceMemoryGb: 4 })).toBe(false);
  });

  it('does not fall back when deviceMemory is unreported (assume capable)', () => {
    expect(shouldUseFallback({ nav: {} })).toBe(false);
  });
});

describe('generateProofViaBackend', () => {
  it('posts to /generate-proof with the expected shape and returns the parsed body', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ proof: { pi_a: [] }, publicSignals: [] }),
    });

    const payload = { taskCondition: { type: 'liquidity-threshold' }, clientData: { witness: {} } };
    const result = await generateProofViaBackend('https://zk.example.com/', payload, {
      fetch: fetchMock,
      authToken: 'token123',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://zk.example.com/generate-proof',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123',
        }),
        body: JSON.stringify(payload),
      }),
    );
    expect(result).toEqual({ proof: { pi_a: [] }, publicSignals: [] });
  });

  it('throws with the response body on a non-ok response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"INVALID_INPUT"}',
    });

    await expect(
      generateProofViaBackend('https://zk.example.com', {}, { fetch: fetchMock }),
    ).rejects.toThrow(/400/);
  });
});

describe('generateProof', () => {
  it('routes to the backend when the device requires the fallback', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ proof: {}, publicSignals: [] }),
    });

    const result = await generateProof(
      {
        backendBaseUrl: 'https://zk.example.com',
        backendPayload: { taskCondition: {}, clientData: {} },
      },
      { nav: { deviceMemory: 1 }, fetch: fetchMock },
    );

    expect(result.source).toBe('backend');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('throws a clear error when the fallback is required but not configured', async () => {
    await expect(
      generateProof({}, { nav: { deviceMemory: 1 } }),
    ).rejects.toThrow(/requires the backend fallback/);
  });

  it('throws a clear error when browser proving is selected but wasmUrl/zkeyUrl are missing', async () => {
    await expect(
      generateProof({ input: {} }, { nav: { deviceMemory: 8 } }),
    ).rejects.toThrow(/wasmUrl\/zkeyUrl are required/);
  });
});
