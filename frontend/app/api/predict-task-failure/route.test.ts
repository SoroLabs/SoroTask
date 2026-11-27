import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/predict-task-failure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/predict-task-failure', () => {
  const validInput = {
    contractAddress: `C${'A'.repeat(55)}`,
    functionName: 'harvest_yield',
    interval: 3600,
    gasBalance: 10,
  };

  it('returns a low configuration risk with explicit heuristic limitations', async () => {
    const response = await POST(request(validInput));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      riskScore: 0,
      confidence: 100,
      riskLevel: 'low',
      riskFactors: [],
      model: 'configuration-rules-v1',
    });
    expect(result.limitations).toEqual(
      expect.arrayContaining([expect.stringContaining('not a trained machine-learning prediction')]),
    );
  });

  it('surfaces high-risk configuration factors and actionable recommendations', async () => {
    const response = await POST(request({
      ...validInput,
      contractAddress: 'invalid-contract',
      functionName: 'Bad Function',
      interval: 30,
      gasBalance: 0,
    }));
    const result = await response.json();

    expect(result.riskLevel).toBe('high');
    expect(result.riskScore).toBe(100);
    expect(result.riskFactors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gas-balance-empty',
          recommendation: expect.stringContaining('positive gas balance'),
        }),
        expect.objectContaining({ id: 'interval-too-short' }),
        expect.objectContaining({ id: 'contract-address' }),
        expect.objectContaining({ id: 'function-name' }),
      ]),
    );
  });

  it('rejects invalid JSON and malformed diagnostic inputs', async () => {
    const invalidJson = await POST(new Request('http://localhost/api/predict-task-failure', {
      method: 'POST',
      body: '{',
    }));
    const invalidInput = await POST(request({ ...validInput, interval: 'soon' }));

    expect(invalidJson.status).toBe(400);
    expect(invalidInput.status).toBe(400);
  });
});
