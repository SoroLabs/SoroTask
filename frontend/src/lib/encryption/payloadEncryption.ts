import { validateEnvelope } from './EncryptionKeyManager';
import { EncryptedEnvelope, EncryptionError } from './types';

/**
 * Helpers that encrypt sensitive task data (task arguments, webhook endpoints
 * and secrets) client-side BEFORE it is handed to the backend, an indexer, or a
 * contract call. Every ciphertext is bound (AES-GCM AAD) to the task id and the
 * field it belongs to, so an operator cannot move a ciphertext from one task or
 * field to another without decryption failing.
 */

/** Anything that can produce/consume envelopes (EncryptionKeyManager satisfies this). */
export interface EnvelopeCipher {
  encryptEnvelope(plaintext: string, context: string, keyId?: string): Promise<EncryptedEnvelope>;
  decryptEnvelope(envelope: unknown, context: string): Promise<string>;
}

export const TASK_ARGS_FIELD = 'args';
export const WEBHOOK_URL_FIELD = 'webhook.url';
export const WEBHOOK_SECRET_FIELD = 'webhook.secret';
export const WEBHOOK_HEADERS_FIELD = 'webhook.headers';

/** Build the AAD context for one field of one task. */
export function taskFieldContext(taskId: string, field: string): string {
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    throw new EncryptionError('A task id is required to bind encrypted data', 'CONTEXT_REQUIRED');
  }
  if (typeof field !== 'string' || field.trim() === '') {
    throw new EncryptionError('A field name is required to bind encrypted data', 'CONTEXT_REQUIRED');
  }
  return `task:${encodeURIComponent(taskId)}:${field}`;
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  try {
    validateEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

/** Compact string form for transports that take a single string (e.g. contract args). */
export function serializeEnvelope(envelope: EncryptedEnvelope): string {
  return JSON.stringify(validateEnvelope(envelope));
}

export function parseEnvelope(serialized: string): EncryptedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new EncryptionError('Invalid encrypted envelope: not JSON', 'INVALID_ENVELOPE', err);
  }
  return validateEnvelope(parsed);
}

// ── Task arguments ──────────────────────────────────────────────────────────

export interface EncryptedTaskArguments {
  /** Public task identifier (already public on-chain); not sensitive. */
  taskId: string;
  encryptedArgs: EncryptedEnvelope;
}

/** JSON-serialize and encrypt task arguments as a single envelope. */
export async function encryptTaskArguments(
  cipher: EnvelopeCipher,
  taskId: string,
  args: unknown,
  keyId?: string,
): Promise<EncryptedTaskArguments> {
  const context = taskFieldContext(taskId, TASK_ARGS_FIELD);
  let json: string | undefined;
  try {
    json = JSON.stringify(args);
  } catch (err) {
    throw new EncryptionError('Task arguments are not JSON-serializable', 'INVALID_PAYLOAD', err);
  }
  if (json === undefined) {
    throw new EncryptionError('Task arguments are not JSON-serializable', 'INVALID_PAYLOAD');
  }
  return { taskId, encryptedArgs: await cipher.encryptEnvelope(json, context, keyId) };
}

export async function decryptTaskArguments<T = unknown>(
  cipher: EnvelopeCipher,
  payload: EncryptedTaskArguments,
): Promise<T> {
  const context = taskFieldContext(payload.taskId, TASK_ARGS_FIELD);
  const json = await cipher.decryptEnvelope(payload.encryptedArgs, context);
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    throw new EncryptionError('Decrypted task arguments are not valid JSON', 'INVALID_PAYLOAD', err);
  }
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}

export interface EncryptedWebhookConfig {
  taskId: string;
  url: EncryptedEnvelope;
  secret?: EncryptedEnvelope;
  headers?: EncryptedEnvelope;
}

function assertWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never echo the URL itself: it may embed credentials or tokens.
    throw new EncryptionError('Webhook URL is not a valid absolute URL', 'INVALID_WEBHOOK_URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new EncryptionError('Webhook URL must use http(s)', 'INVALID_WEBHOOK_URL');
  }
}

/** Encrypt a webhook endpoint (and optional secret/headers), each bound to its own field. */
export async function encryptWebhookConfig(
  cipher: EnvelopeCipher,
  taskId: string,
  config: WebhookConfig,
  keyId?: string,
): Promise<EncryptedWebhookConfig> {
  assertWebhookUrl(config.url);
  const result: EncryptedWebhookConfig = {
    taskId,
    url: await cipher.encryptEnvelope(config.url, taskFieldContext(taskId, WEBHOOK_URL_FIELD), keyId),
  };
  if (config.secret !== undefined) {
    result.secret = await cipher.encryptEnvelope(
      config.secret,
      taskFieldContext(taskId, WEBHOOK_SECRET_FIELD),
      keyId,
    );
  }
  if (config.headers !== undefined) {
    result.headers = await cipher.encryptEnvelope(
      JSON.stringify(config.headers),
      taskFieldContext(taskId, WEBHOOK_HEADERS_FIELD),
      keyId,
    );
  }
  return result;
}

export async function decryptWebhookConfig(
  cipher: EnvelopeCipher,
  payload: EncryptedWebhookConfig,
): Promise<WebhookConfig> {
  const { taskId } = payload;
  const config: WebhookConfig = {
    url: await cipher.decryptEnvelope(payload.url, taskFieldContext(taskId, WEBHOOK_URL_FIELD)),
  };
  if (payload.secret !== undefined) {
    config.secret = await cipher.decryptEnvelope(payload.secret, taskFieldContext(taskId, WEBHOOK_SECRET_FIELD));
  }
  if (payload.headers !== undefined) {
    const json = await cipher.decryptEnvelope(payload.headers, taskFieldContext(taskId, WEBHOOK_HEADERS_FIELD));
    try {
      config.headers = JSON.parse(json) as Record<string, string>;
    } catch (err) {
      throw new EncryptionError('Decrypted webhook headers are not valid JSON', 'INVALID_PAYLOAD', err);
    }
  }
  return config;
}

// ── Transport guard ─────────────────────────────────────────────────────────

/**
 * Throw unless every listed (dot-path) field of an outgoing request body is an
 * encrypted envelope. Call right before `fetch`/contract invocation as a last
 * line of defence against accidentally sending plaintext.
 * The error names the field, never its value.
 */
export function assertEncryptedFields(payload: unknown, fieldPaths: string[]): void {
  for (const path of fieldPaths) {
    let current: unknown = payload;
    for (const segment of path.split('.')) {
      if (current === null || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (current === undefined) continue; // optional field absent
    if (!isEncryptedEnvelope(current)) {
      throw new EncryptionError(`Field "${path}" must be encrypted before transmission`, 'PLAINTEXT_FIELD');
    }
  }
}
