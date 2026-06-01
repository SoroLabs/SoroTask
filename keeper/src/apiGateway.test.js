const { ApiGateway } = require('./apiGateway');

describe('ApiGateway', () => {
  test('throttles repeated requests for the same principal and route', () => {
    const gateway = new ApiGateway({
      routePolicies: {
        '/admin/keeper': {
          capacity: 1,
          refillPerSecond: 0.1,
          billingUnits: 1,
        },
      },
    });

    const req = {
      headers: { 'x-api-key': 'keeper-admin' },
      socket: { remoteAddress: '127.0.0.1' },
    };

    expect(gateway.evaluate(req, '/admin/keeper').allowed).toBe(true);
    const throttled = gateway.evaluate(req, '/admin/keeper');

    expect(throttled.allowed).toBe(false);
    expect(throttled.retryAfterMs).toBeGreaterThan(0);

    const usage = gateway.getUsageSummary();
    expect(usage.totalRequests).toBe(2);
    expect(usage.totalThrottled).toBe(1);
    expect(usage.routes['/admin/keeper'].billedUnits).toBe(1);
  });
});