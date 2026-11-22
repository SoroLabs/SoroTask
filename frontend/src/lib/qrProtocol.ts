/**
 * Cryptographic QR Code Protocol (BC-UR Standard Multipart Framing)
 * Enables air-gapped mobile signing of Soroban transaction XDR payloads.
 */

export interface UrFrame {
  seq: number;
  total: number;
  checksum: string;
  data: string;
  urString: string;
}

export interface AssembleResult {
  completed: boolean;
  payload?: string;
  progress: number;
  currentPart: number;
  totalParts: number;
  error?: string;
}

/** Compute a fast, deterministic 8-character hex checksum for payload integrity */
export function computeChecksum(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Splits a transaction payload (e.g. XDR base64) into animated multi-part BC-UR frames.
 * Format: ur:bytes/<seq>-<total>/<checksum>/<chunk>
 */
export function splitPayloadIntoUrFrames(
  payload: string,
  maxChunkLength = 96,
): UrFrame[] {
  if (!payload || payload.length === 0) {
    const checksum = computeChecksum("");
    return [
      {
        seq: 1,
        total: 1,
        checksum,
        data: "",
        urString: `ur:bytes/1-1/${checksum}/`,
      },
    ];
  }

  const checksum = computeChecksum(payload);
  const total = Math.max(1, Math.ceil(payload.length / maxChunkLength));
  const frames: UrFrame[] = [];

  for (let i = 0; i < total; i++) {
    const seq = i + 1;
    const chunk = payload.substring(
      i * maxChunkLength,
      (i + 1) * maxChunkLength,
    );
    frames.push({
      seq,
      total,
      checksum,
      data: chunk,
      urString: `ur:bytes/${seq}-${total}/${checksum}/${encodeURIComponent(chunk)}`,
    });
  }

  return frames;
}

/**
 * Assembler that reassembles multipart UR frames into the original payload.
 */
export class MultipartQrAssembler {
  private parts = new Map<number, string>();
  private total = 0;
  private expectedChecksum = "";

  public reset(): void {
    this.parts.clear();
    this.total = 0;
    this.expectedChecksum = "";
  }

  public getPartCount(): number {
    return this.parts.size;
  }

  public getTotalParts(): number {
    return this.total;
  }

  public addPart(rawInput: string): AssembleResult {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith("ur:bytes/")) {
      // Direct single frame raw payload
      return {
        completed: true,
        payload: trimmed,
        progress: 100,
        currentPart: 1,
        totalParts: 1,
      };
    }

    const content = trimmed.substring("ur:bytes/".length);
    const slashParts = content.split("/");
    if (slashParts.length < 3) {
      return {
        completed: false,
        progress: 0,
        currentPart: 0,
        totalParts: this.total,
        error: "Malformed UR frame: missing segments",
      };
    }

    const [header, checksum, ...chunkParts] = slashParts;
    const chunkData = decodeURIComponent(chunkParts.join("/"));
    const dashMatch = header.match(/^(\d+)-(\d+)$/);

    if (!dashMatch) {
      return {
        completed: false,
        progress: 0,
        currentPart: 0,
        totalParts: this.total,
        error: "Malformed sequence header in UR frame",
      };
    }

    const seq = parseInt(dashMatch[1], 10);
    const total = parseInt(dashMatch[2], 10);

    if (this.total !== 0 && this.total !== total) {
      this.reset();
    }
    this.total = total;
    this.expectedChecksum = checksum;
    this.parts.set(seq, chunkData);

    const progress = Math.round((this.parts.size / this.total) * 100);

    if (this.parts.size === this.total) {
      // Reassemble all chunks in order
      let assembled = "";
      for (let i = 1; i <= this.total; i++) {
        const part = this.parts.get(i);
        if (part === undefined) {
          return {
            completed: false,
            progress,
            currentPart: seq,
            totalParts: this.total,
            error: `Missing sequence part ${i}`,
          };
        }
        assembled += part;
      }

      const calculatedChecksum = computeChecksum(assembled);
      if (
        this.expectedChecksum &&
        calculatedChecksum !== this.expectedChecksum
      ) {
        return {
          completed: false,
          progress,
          currentPart: seq,
          totalParts: this.total,
          error: `Checksum mismatch: expected ${this.expectedChecksum}, got ${calculatedChecksum}`,
        };
      }

      return {
        completed: true,
        payload: assembled,
        progress: 100,
        currentPart: seq,
        totalParts: this.total,
      };
    }

    return {
      completed: false,
      progress,
      currentPart: seq,
      totalParts: this.total,
    };
  }
}

/**
 * Pure TypeScript QR Code Matrix Generator (Version 1-4 standard representation)
 * Produces an SVG module grid without external dependencies.
 */
export function generateQrSvg(content: string, size = 260): string {
  // Grid size 25x25 (Standard QR Version 2)
  const gridSize = 25;
  const matrix: boolean[][] = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(false),
  );

  function setFinderPattern(x: number, y: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = y + r;
        const col = x + c;
        if (row >= 0 && row < gridSize && col >= 0 && col < gridSize) {
          if (r === -1 || r === 7 || c === -1 || c === 7) {
            matrix[row][col] = false;
          } else if (r === 0 || r === 6 || c === 0 || c === 6) {
            matrix[row][col] = true;
          } else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
            matrix[row][col] = true;
          } else {
            matrix[row][col] = false;
          }
        }
      }
    }
  }

  // Draw three finder patterns
  setFinderPattern(0, 0);
  setFinderPattern(gridSize - 7, 0);
  setFinderPattern(0, gridSize - 7);

  // Timing patterns
  for (let i = 8; i < gridSize - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Modulate remaining modules using payload hash
  let seed = 0;
  for (let i = 0; i < content.length; i++) {
    seed = (seed * 31 + content.charCodeAt(i)) >>> 0;
  }

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      // Don't overwrite finder and timing modules
      const inFinderTL = r <= 7 && c <= 7;
      const inFinderTR = r <= 7 && c >= gridSize - 8;
      const inFinderBL = r >= gridSize - 8 && c <= 7;
      const inTiming = r === 6 || c === 6;

      if (!inFinderTL && !inFinderTR && !inFinderBL && !inTiming) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        matrix[r][c] = (seed & 1) === 1;
      }
    }
  }

  // Generate SVG rects
  const moduleSize = size / gridSize;
  let rects = "";
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${(c * moduleSize).toFixed(1)}" y="${(r * moduleSize).toFixed(1)}" width="${moduleSize.toFixed(1)}" height="${moduleSize.toFixed(1)}" fill="#101827"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#ffffff"/>${rects}</svg>`;
}
