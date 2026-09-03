'use strict';

/**
 * ssrfGuard.test.js — SSRF filter behaviour (Issue #1056).
 *
 * The DNS resolver is injected throughout so the tests are hermetic: a real
 * lookup would make them depend on the network and on whoever controls the
 * test domains.
 */

const {
  assertUrlAllowed,
  safeFetch,
  isBlockedAddress,
  SsrfBlockedError,
} = require('../src/ssrfGuard');

/** Resolver stub: every hostname answers with `addresses`. */
const resolveTo = (...addresses) => async () => addresses.map((address) => ({ address }));

describe('isBlockedAddress', () => {
  it('blocks the cloud metadata endpoint', () => {
    // The single most valuable SSRF target: returns IAM credentials on
    // AWS, GCP and Azure alike.
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('blocks loopback and RFC 1918 space', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('does not block public addresses adjacent to private ranges', () => {
    // 172.15/172.32 sit either side of the 172.16.0.0/12 block, and 9/11.x
    // either side of 10/8 — off-by-one mask errors show up here.
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '9.255.255.255', '11.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it('blocks IPv6 loopback, link-local, unique-local and multicast', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::abcd', 'ff02::1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it('blocks IPv4-mapped IPv6 forms of private addresses', () => {
    // ::ffff:169.254.169.254 reaches metadata just as well as the bare form.
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('blocks anything that is not an IP literal', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('assertUrlAllowed', () => {
  it('allows a public HTTPS endpoint', async () => {
    const result = await assertUrlAllowed('https://hooks.example.com/notify', {
      lookup: resolveTo('93.184.216.34'),
    });
    expect(result.url.hostname).toBe('hooks.example.com');
    expect(result.addresses).toEqual(['93.184.216.34']);
  });

  it('blocks a literal metadata URL without needing DNS', async () => {
    await expect(
      assertUrlAllowed('http://169.254.169.254/latest/meta-data/', {
        lookup: () => {
          throw new Error('lookup must not be called for an IP literal');
        },
      })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('blocks a public hostname that resolves to a private address', async () => {
    // The case a string-matching filter misses entirely: the attacker owns
    // the DNS, so the hostname reveals nothing.
    await expect(
      assertUrlAllowed('https://totally-legit.example.com/hook', {
        lookup: resolveTo('169.254.169.254'),
      })
    ).rejects.toThrow(/Blocked address/);
  });

  it('blocks when any resolved address is private, not just the first', async () => {
    // A client may connect to any A record, so one poisoned answer is enough.
    await expect(
      assertUrlAllowed('https://mixed.example.com/hook', {
        lookup: resolveTo('93.184.216.34', '10.0.0.1'),
      })
    ).rejects.toThrow(/Blocked address/);
  });

  it('rejects non-HTTP schemes', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(assertUrlAllowed(url)).rejects.toThrow(/Protocol not allowed/);
    }
  });

  it('rejects a malformed URL', async () => {
    await expect(assertUrlAllowed('not a url')).rejects.toThrow(/Malformed URL/);
  });

  it('rejects when DNS fails rather than falling through', async () => {
    await expect(
      assertUrlAllowed('https://nx.example.com/hook', {
        lookup: async () => {
          throw new Error('ENOTFOUND');
        },
      })
    ).rejects.toThrow(/DNS resolution failed/);
  });

  it('honours allowPrivate for operator-configured internal endpoints', async () => {
    const result = await assertUrlAllowed('http://127.0.0.1:9000/internal', { allowPrivate: true });
    expect(result.url.port).toBe('9000');
  });
});

describe('safeFetch', () => {
  const okResponse = { status: 200, headers: { get: () => null } };

  it('passes a public URL through to fetch', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse);
    const res = await safeFetch('https://hooks.example.com/notify', { method: 'POST' }, {
      fetchImpl,
      lookup: resolveTo('93.184.216.34'),
    });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Redirects must be manual, or the built-in follower would perform the
    // next hop before the filter could inspect it.
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
  });

  it('never calls fetch for a blocked URL', async () => {
    const fetchImpl = jest.fn();
    await expect(
      safeFetch('http://169.254.169.254/', {}, { fetchImpl })
    ).rejects.toThrow(SsrfBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-validates redirect targets and blocks a redirect into metadata', async () => {
    // The bypass this exists to stop: the first URL is genuinely public and
    // passes the filter, then hands back a 302 into link-local space.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (h) => (h === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
      });

    await expect(
      safeFetch('https://hooks.example.com/notify', {}, {
        fetchImpl,
        lookup: resolveTo('93.184.216.34'),
      })
    ).rejects.toThrow(SsrfBlockedError);

    // The redirect was fetched once; the metadata hop never was.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to another public host', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (h) => (h === 'location' ? 'https://other.example.com/final' : null) },
      })
      .mockResolvedValueOnce(okResponse);

    const res = await safeFetch('https://hooks.example.com/notify', {}, {
      fetchImpl,
      lookup: resolveTo('93.184.216.34'),
    });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://other.example.com/final');
  });

  it('stops after maxRedirects rather than looping forever', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      status: 302,
      headers: { get: (h) => (h === 'location' ? 'https://hooks.example.com/loop' : null) },
    });

    await expect(
      safeFetch('https://hooks.example.com/notify', {}, {
        fetchImpl,
        maxRedirects: 2,
        lookup: resolveTo('93.184.216.34'),
      })
    ).rejects.toThrow(/Too many redirects/);
  });
});
