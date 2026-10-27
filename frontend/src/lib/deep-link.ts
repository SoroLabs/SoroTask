import { z } from "zod";

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
      config: z.record(z.string(), z.unknown()),
      dependencies: z.array(z.string()),
    }),
  ),
  version: z.string(),
  creatorSignature: z.string(),
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class DeepLinkManager {
  private static readonly VERSION = "1.0.0";
  private static readonly MAX_URL_LENGTH = 2048;

  static async encodeDAG(dag: TaskDAG): Promise<string> {
    const validated = TaskDAGSchema.parse(dag);
    const jsonString = JSON.stringify(validated);
    const signature = await this.signPayload(await sha256Hex(jsonString));
    const encoded = bytesToBase64(encoder.encode(jsonString));

    const urlFragment = `${encoded}:${signature}`;

    if (urlFragment.length > this.MAX_URL_LENGTH) {
      const truncated = this.chunkDAG(validated);
      return `https://sorotask.app/share?chunk=0&total=${truncated.length}&data=${encodeURIComponent(truncated[0])}`;
    }

    return `https://sorotask.app/share#${urlFragment}`;
  }

  static async decodeURL(url: string): Promise<TaskDAG | null> {
    try {
      const fragment = url.split("#")[1];
      if (!fragment) return null;

      const [encoded, signature] = fragment.split(":");
      const jsonString = decoder.decode(base64ToBytes(encoded));
      const dag = TaskDAGSchema.parse(JSON.parse(jsonString));

      const hash = await sha256Hex(jsonString);
      if (!(await this.verifySignature(hash, signature))) {
        throw new Error("Invalid signature");
      }

      return dag;
    } catch {
      return null;
    }
  }

  private static async signPayload(hash: string): Promise<string> {
    return sha256Hex(`sorotask:${hash}`);
  }

  private static async verifySignature(
    hash: string,
    signature: string,
  ): Promise<boolean> {
    if (!signature) return false;
    return signature === (await this.signPayload(hash));
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

    return `https://sorotask.app/share?data=${encodeURIComponent(
      bytesToBase64(encoder.encode(JSON.stringify(payload))),
    )}`;
  }
}
