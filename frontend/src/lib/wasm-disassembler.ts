export interface WasmSection {
  id: number;
  name: string;
  size: number;
  content: Uint8Array;
}

export interface WasmImport {
  module: string;
  name: string;
  kind: number;
}

export interface WasmExport {
  name: string;
  kind: number;
}

export interface SecurityFlag {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description: string;
  offset?: number;
}

export interface DisassemblyResult {
  version: number;
  sections: WasmSection[];
  imports: WasmImport[];
  exports: WasmExport[];
  securityFlags: SecurityFlag[];
  trustScore: number;
  isValid: boolean;
  error?: string;
}

const SECTION_NAMES: Record<number, string> = {
  0: "Custom",
  1: "Type",
  2: "Import",
  3: "Function",
  4: "Table",
  5: "Memory",
  6: "Global",
  7: "Export",
  8: "Start",
  9: "Element",
  10: "Code",
  11: "Data",
  12: "DataCount",
};

const EXPORT_KIND_NAMES: Record<number, string> = {
  0: "Func",
  1: "Table",
  2: "Memory",
  3: "Global",
};

const IMPORT_KIND_NAMES: Record<number, string> = {
  0: "Func",
  1: "Table",
  2: "Memory",
  3: "Global",
};

function readUint32Leb128(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < data.length) {
    const byte = data[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, pos];
}

function readString(data: Uint8Array, offset: number): [string, number] {
  const [len, pos] = readUint32Leb128(data, offset);
  const decoder = new TextDecoder();
  const str = decoder.decode(data.slice(pos, pos + len));
  return [str, pos + len];
}

function detectSecurityFlags(
  bytes: Uint8Array,
  imports: WasmImport[],
  exports: WasmExport[]
): SecurityFlag[] {
  const flags: SecurityFlag[] = [];

  const suspiciousImports = imports.filter(
    (imp) =>
      imp.module.includes("env") &&
      (imp.name.includes("memory") ||
        imp.name.includes("grow") ||
        imp.name.includes("delegate"))
  );
  if (suspiciousImports.length > 0) {
    flags.push({
      severity: "high",
      category: "Suspicious Imports",
      description: `Found ${suspiciousImports.length} potentially dangerous import(s): ${suspiciousImports.map((i) => i.name).join(", ")}`,
    });
  }

  const uncheckedMemoryGrowth = imports.some(
    (imp) => imp.name === "memory.grow"
  );
  if (uncheckedMemoryGrowth) {
    flags.push({
      severity: "medium",
      category: "Memory Growth",
      description: "Contract can grow memory unbounded — potential DoS vector",
    });
  }

  let loopCount = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x03 && bytes[i + 1] === 0x40) {
      loopCount++;
    }
  }
  if (loopCount > 20) {
    flags.push({
      severity: "medium",
      category: "Loop Density",
      description: `Detected ${loopCount} loop constructs — verify no unbounded loops`,
    });
  }

  let unreachableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x00) {
      unreachableCount++;
    }
  }
  if (unreachableCount > 100) {
    flags.push({
      severity: "low",
      category: "Unreachable Code",
      description: "High number of unreachable instructions detected",
    });
  }

  const suspiciousExportNames = exports.filter(
    (exp) =>
      exp.name.includes("admin") ||
      exp.name.includes("upgrade") ||
      exp.name.includes("migrate") ||
      exp.name.includes("selfdestruct")
  );
  if (suspiciousExportNames.length > 0) {
    flags.push({
      severity: "critical",
      category: "Dangerous Exports",
      description: `Potentially dangerous exported functions: ${suspiciousExportNames.map((e) => e.name).join(", ")}`,
    });
  }

  return flags;
}

function calculateTrustScore(flags: SecurityFlag[]): number {
  let score = 100;
  for (const flag of flags) {
    switch (flag.severity) {
      case "critical":
        score -= 30;
        break;
      case "high":
        score -= 20;
        break;
      case "medium":
        score -= 10;
        break;
      case "low":
        score -= 5;
        break;
    }
  }
  return Math.max(0, score);
}

export function disassembleWasm(bytes: Uint8Array): DisassemblyResult {
  const result: DisassemblyResult = {
    version: 0,
    sections: [],
    imports: [],
    exports: [],
    securityFlags: [],
    trustScore: 100,
    isValid: false,
  };

  try {
    if (bytes.length < 8) {
      result.error = "File too small to be valid WASM";
      return result;
    }

    const magic = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    if (magic !== 0x6d736100) {
      result.error = "Invalid WASM magic number";
      return result;
    }

    result.version = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
    let pos = 8;

    while (pos < bytes.length) {
      if (pos + 2 > bytes.length) break;

      const sectionId = bytes[pos];
      pos++;
      const [sectionSize, newPos] = readUint32Leb128(bytes, pos);
      pos = newPos;

      const sectionContent = bytes.slice(pos, pos + sectionSize);
      result.sections.push({
        id: sectionId,
        name: SECTION_NAMES[sectionId] || `Unknown(${sectionId})`,
        size: sectionSize,
        content: sectionContent,
      });

      if (sectionId === 2) {
        let importPos = 0;
        const [importCount, ip] = readUint32Leb128(sectionContent, 0);
        importPos = ip;
        for (let i = 0; i < importCount && importPos < sectionContent.length; i++) {
          const [module, mp] = readString(sectionContent, importPos);
          importPos = mp;
          const [name, np] = readString(sectionContent, importPos);
          importPos = np;
          const kind = sectionContent[importPos];
          importPos++;
          result.imports.push({ module, name, kind });
        }
      }

      if (sectionId === 7) {
        let exportPos = 0;
        const [exportCount, ep] = readUint32Leb128(sectionContent, 0);
        exportPos = ep;
        for (let i = 0; i < exportCount && exportPos < sectionContent.length; i++) {
          const [name, np] = readString(sectionContent, exportPos);
          exportPos = np;
          const kind = sectionContent[exportPos];
          exportPos++;
          result.exports.push({ name, kind });
        }
      }

      pos += sectionSize;
    }

    result.securityFlags = detectSecurityFlags(bytes, result.imports, result.exports);
    result.trustScore = calculateTrustScore(result.securityFlags);
    result.isValid = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : "Unknown error during disassembly";
  }

  return result;
}

export function formatSectionName(id: number): string {
  return SECTION_NAMES[id] || `Unknown(${id})`;
}

export function formatExportKind(kind: number): string {
  return EXPORT_KIND_NAMES[kind] || `Unknown(${kind})`;
}

export function formatImportKind(kind: number): string {
  return IMPORT_KIND_NAMES[kind] || `Unknown(${kind})`;
}
