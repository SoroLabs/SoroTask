export interface CspOptions {
  nonce?: string;
  isDev?: boolean;
  extraDirectives?: Record<string, string[]>;
  reportUri?: string;
}

/**
 * Generates a dynamic Content Security Policy (CSP) string.
 * Time Complexity: O(D + E) where D is the number of base directives and E is the number of extra directives.
 * Space Complexity: O(D + E) to store the policy strings.
 *
 * @param options - Configuration for the CSP generation.
 * @returns Formatted CSP string.
 */
export function generateCsp(options: CspOptions = {}): string {
  const { nonce, isDev = process.env.NODE_ENV === 'development', extraDirectives = {}, reportUri } = options;

  const baseDirectives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'strict-dynamic'"],
    'style-src': ["'self'"],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  if (nonce) {
    baseDirectives['script-src'].push(`'nonce-${nonce}'`);
    baseDirectives['style-src'].push(`'nonce-${nonce}'`);
  }

  if (isDev) {
    // Next.js development tooling uses eval for hot module replacement.
    baseDirectives['script-src'].push("'unsafe-eval'");
  }

  if (reportUri) {
    baseDirectives['report-uri'] = [reportUri];
  }

  // Merge extra directives
  for (const [key, values] of Object.entries(extraDirectives)) {
    if (baseDirectives[key]) {
      baseDirectives[key] = Array.from(new Set([...baseDirectives[key], ...values]));
    } else {
      baseDirectives[key] = values;
    }
  }

  return Object.entries(baseDirectives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(' ')}`;
    })
    .join('; ');
}
