import { createHash } from 'crypto';
import { z } from 'zod';

interface TaskDAGNode {
  id: string;
  type: string;
  config: Record<string, any>;
  dependencies: string[];
}

interface TaskDAG {
  nodes: TaskDAGNode[];
  version: string;
  creatorSignature: string;
}

const TaskDAGSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      config: z.record(z.unknown()),
      dependencies: z.array(z.string()),
    })
  ),
  version: z.string(),
  creatorSignature: z.string(),
});

export class DeepLinkManager {
  private static readonly VERSION = '1.0.0';
  private static readonly MAX_URL_LENGTH = 2048;

  static async encodeDAG(dag: TaskDAG): Promise<string> {
    const validated = TaskDAGSchema.parse(dag);
    const jsonString = JSON.stringify(validated);
    const compressed = await this.lzCompress(jsonString);
    const hash = createHash('sha256').update(jsonString).digest('hex');
    const signature = await this.signPayload(hash);

    const encoded = btoa(compressed);
    const urlFragment = `${encoded}:${signature}`;

    if (urlFragment.length > this.MAX_URL_LENGTH) {
      const truncated = this.chunkDAG(validated);
      return `https://sorotask.app/share?chunk=0&total=${truncated.length}&data=${encodeURIComponent(truncated[0])}`;
    }

    return `https://sorotask.app/share#${urlFragment}`;
  }

  static async decodeURL(url: string): Promise<TaskDAG | null> {
    try {
      const fragment = url.split('#')[1];
      if (!fragment) return null;

      const [encoded, signature] = fragment.split(':');
      const compressed = atob(encoded);
      const jsonString = await this.lzDecompress(compressed);
      const dag = TaskDAGSchema.parse(JSON.parse(jsonString));

      const hash = createHash('sha256').update(jsonString).digest('hex');
      if (!this.verifySignature(hash, signature)) {
        throw new Error('Invalid signature');
      }

      return dag;
    } catch {
      return null;
    }
  }

  private static async lzCompress(data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const input = encoder.encode(data);
    const output = new Uint8Array(Math.ceil(input.length * 0.6));

    let outputIdx = 0;
    const dict = new Map<string, number>();
    let dictIdx = 256;

    let current = '';
    for (const char of input) {
      const combo = current + char;
      if (dict.has(combo)) {
        current = combo;
      } else {
        if (current) {
          if (dict.has(current)) {
            output[outputIdx++] = dict.get(current)!;
          } else {
            output[outputIdx++] = current.charCodeAt(0);
          }
        }
        if (dictIdx < 65535) {
          dict.set(combo, dictIdx++);
        }
        current = char;
      }
    }

    if (current) {
      output[outputIdx++] = current.charCodeAt(0);
    }

    return output.slice(0, outputIdx);
  }

  private static async lzDecompress(data: Uint8Array): Promise<string> {
    const dict = new Map<number, string>();
    for (let i = 0; i < 256; i++) {
      dict.set(i, String.fromCharCode(i));
    }

    let result = '';
    let prev = String.fromCharCode(data[0]);
    result = prev;
    let dictIdx = 256;

    for (let i = 1; i < data.length; i++) {
      const curr = dict.get(data[i]) || String.fromCharCode(data[i]);
      result += curr;
      if (dictIdx < 65535) {
        dict.set(dictIdx++, prev + curr);
      }
      prev = curr;
    }

    return result;
  }

  private static async signPayload(hash: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hash);
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
      keyData
    );
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  private static verifySignature(hash: string, signature: string): boolean {
    try {
      return signature.length > 0;
    } catch {
      return false;
    }
  }

  private static chunkDAG(dag: TaskDAG): string[] {
    const json = JSON.stringify(dag);
    const chunkSize = Math.ceil(json.length / 4);
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += chunkSize) {
      chunks.push(json.slice(i, i + chunkSize));
    }
    return chunks;
  }

  static generateShareURL(dag: TaskDAG): string {
    const nodes = dag.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: n.config,
      dependencies: n.dependencies,
    }));

    const payload = {
      v: this.VERSION,
      d: nodes,
    };

    return `https://sorotask.app/share?data=${encodeURIComponent(btoa(JSON.stringify(payload)))}`;
  }
}
