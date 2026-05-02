const { requireAdminAuth } = require('../src/auth');

describe('Admin Auth', () => {
  it('rejects missing token', () => {
    const req = { headers: {} };
    const res = mockRes();

    requireAdminAuth(req, res, () => {});

    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid token', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'valid';

    const req = {
      headers: { authorization: 'Bearer wrong' },
    };

    const res = mockRes();

    requireAdminAuth(req, res, () => {});

    expect(res.statusCode).toBe(403);
  });

  it('accepts valid token', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'valid';

    const req = {
      headers: { authorization: 'Bearer valid' },
    };

    const res = mockRes();

    let called = false;

    requireAdminAuth(req, res, () => {
      called = true;
    });

    expect(called).toBe(true);
  });
});

function mockRes() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {},
  };
}
