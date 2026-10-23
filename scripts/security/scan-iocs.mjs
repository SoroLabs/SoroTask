#!/usr/bin/env node
/**
 * Scans the changes in a pull request (or main push) for the malware
 * indicators published for the SoroTask contribution wave, plus a few
 * supply-chain heuristics. Reads git objects only; never executes PR code.
 *
 * Usage: BASE_SHA=<base> HEAD_SHA=<head> node scripts/security/scan-iocs.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.BASE_SHA || '';
const HEAD = process.env.HEAD_SHA || 'HEAD';
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

const MARKERS = ['rmcej%otb%', 'Cot%3T=sthP', '_$__1e42'];
const SELF = new Set(['scripts/security/scan-iocs.mjs']);
const LOCKFILES = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/;
const BINARY_EXT = /\.(?:woff2?|ttf|eot|otf|lik|wasm|exe|dll|so|node|bin|jar|class|pyc)$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|pdf|zip|gz|tar|7z)$/i;
const FONT_IOC = /^(?:fa-solid-(?:300\.ttf|500\.woff2|600\.eot)|fa-solid\.lik)$/i;
const CONFIG = /(?:^|\/)(?:postcss|tailwind|eslint|next|jest|vite)\.config\.(?:js|cjs|mjs|ts)$/i;
const CODE = /\.(?:js|cjs|mjs|tsx?|jsx|rs|sh)$/i;
const I18N = /(?:^|\/)(?:i18n|locales?|translations)(?:\/|\.|$)|LanguageSelector\.tsx$|formatting\.ts$/i;
const TEST = /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|\.|$)|\.(?:test|spec)\.[^/]+$/i;
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const SUSPICIOUS_HOSTS = /(?:webhook\.site|pastebin\.com|ngrok(?:-free)?\.(?:io|app)|transfer\.sh|file\.io|0x0\.st|discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org)/i;
const PUBLIC_IP_URL = /https?:\/\/(?!(?:0|10|127|169\.254|192\.168)\.)(?!(?:172\.(?:1[6-9]|2\d|3[01]))\.)\d{1,3}(?:\.\d{1,3}){3}/;
const DYNAMIC_CODE = /(?<![.\w$])(?:eval|new\s+Function)\s*\(/;
const PRIVATE_KEY = /BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY/;

const findings = [];
const add = (level, file, line, message) => findings.push({ level, file, line, message });

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function resolveBase() {
  if (BASE && !/^0+$/.test(BASE) && gitOk(['cat-file', '-e', `${BASE}^{commit}`])) return BASE;
  if (gitOk(['rev-parse', '--verify', 'HEAD^'])) return 'HEAD^';
  return null;
}

function show(ref, file) {
  try {
    return git(['show', `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function changedFiles(base) {
  const range = base ? `${base}...${HEAD}` : HEAD;
  const out = git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRTUXB', range]);
  return out.split('\0').filter(Boolean);
}

function statusMap(base) {
  const range = base ? `${base}...${HEAD}` : HEAD;
  const out = git(['diff', '--raw', '-z', '--no-renames', '--diff-filter=ACMRTUXB', range]);
  const parts = out.split('\0');
  const map = new Map();
  for (let i = 0; i < parts.length; i += 1) {
    const meta = parts[i];
    if (!meta.startsWith(':')) continue;
    const fields = meta.slice(1).split(' ');
    const file = parts[++i];
    if (!file) continue;
    map.set(file, {
      oldMode: fields[0],
      newMode: fields[1],
      status: (fields[4] || '').charAt(0),
    });
  }
  return map;
}

function numstatMap(base) {
  const range = base ? `${base}...${HEAD}` : HEAD;
  const out = git(['diff', '--numstat', '-z', '--no-renames', range]);
  const map = new Map();
  for (const record of out.split('\0')) {
    if (!record) continue;
    const first = record.indexOf('\t');
    const second = record.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    map.set(record.slice(second + 1), {
      additions: record.slice(0, first),
      deletions: record.slice(first + 1, second),
    });
  }
  return map;
}

function addedLines(base, file) {
  if (!base) {
    const text = show(HEAD, file) || '';
    return text.split('\n');
  }
  const out = git(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', `${base}...${HEAD}`, '--', file]);
  return out
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function firstLine(text, regex) {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => regex.test(line));
  return index >= 0 ? index + 1 : null;
}

function appendedConfigBlock(text) {
  const lines = text.split('\n');
  let blanks = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      blanks += 1;
      continue;
    }
    if (blanks >= 10) {
      const line = lines[i].trim();
      const isCommentOrClose = /^(?:\/\/|\/\*|\*|#|--|\]|\}|\))/.test(line);
      if (!isCommentOrClose) return i + 1;
    }
    blanks = 0;
  }
  return null;
}

function annotation(level, file, line, message) {
  const prop = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
  const data = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const location = line ? ` file=${prop(file)},line=${line}` : ` file=${prop(file)}`;
  console.log(`::${level}${location}::${data(message)}`);
}

const base = resolveBase();
const files = changedFiles(base);
const statuses = statusMap(base);
const numstats = numstatMap(base);

for (const file of files) {
  if (SELF.has(file)) continue;

  const status = statuses.get(file) || {};
  const stat = numstats.get(file) || {};
  const baseName = path.basename(file).toLowerCase();
  const name = path.basename(file);
  const isAdded = status.status === 'A';

  if (file.startsWith('.vscode/')) {
    add('error', file, null, 'editor automation files are not allowed (runOn/tasks.json auto-execution)');
  }
  if (FONT_IOC.test(baseName) || BINARY_EXT.test(baseName)) {
    add('error', file, null, `binary/font file added or modified: ${name}`);
  } else if (stat.additions === '-' || stat.deletions === '-') {
    if (IMAGE_EXT.test(baseName)) add('warning', file, null, 'binary file changed; verify it is intended');
    else add('error', file, null, 'unrecognized binary file added or modified');
  }
  if (status.newMode === '160000') {
    add('error', file, null, 'git submodule added or changed');
  } else if (status.newMode === '120000') {
    add('warning', file, null, 'symlink added or changed');
  } else if (status.newMode === '100755') {
    add('warning', file, null, 'executable file added or changed');
  }
  if (isAdded && /(?:^|\/)(?:setup|preinstall|postinstall|install)\.js$/i.test(file)) {
    add('error', file, null, 'install-time script file added');
  }
  if (isAdded && /(?:^|\/)api\.js$/i.test(file)) {
    add('warning', file, null, 'new api.js entry point added; confirm it is not wired into install/start scripts');
  }
  if (/(?:^|\/)\.(?:npmrc|yarnrc(?:\.yml)?)$/i.test(file)) {
    add('error', file, null, 'package manager configuration changed; review registry and script settings');
  }
  if (file.startsWith('.github/workflows/')) {
    add('warning', file, null, 'workflow changed; requires maintainer review');
  }
  if (file === '.github/CODEOWNERS') {
    add('warning', file, null, 'CODEOWNERS changed; requires maintainer review');
  }

  const lines = addedLines(base, file);
  for (const line of lines) {
    const lineNumber = null;
    for (const marker of MARKERS) {
      if (line.includes(marker)) add('error', file, lineNumber, 'known malware marker found');
    }
    if (PRIVATE_KEY.test(line)) add('error', file, lineNumber, 'private key material committed');
    if (PUBLIC_IP_URL.test(line)) add('error', file, lineNumber, 'URL with a public IP literal found');
    if (SUSPICIOUS_HOSTS.test(line)) add('error', file, lineNumber, 'known paste/webhook exfiltration host found');
    if (line.length > 2000) add('warning', file, lineNumber, `very long line (${line.length} chars) may contain obfuscated code`);
  }

  if (name === 'package.json') {
    let after = null;
    let before = null;
    try {
      after = JSON.parse(show(HEAD, file) || '{}');
    } catch {
      add('error', file, null, 'package.json is not valid JSON');
      continue;
    }
    if (base) {
      try {
        before = JSON.parse(show(base, file) || '{}');
      } catch {
        before = null;
      }
    }
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepack']) {
      const next = after?.scripts?.[key];
      const previous = before?.scripts?.[key];
      if (next && next !== previous) {
        const allowed = file === 'package.json' && key === 'prepare' && next.trim() === 'husky || true';
        if (!allowed) add('error', file, null, `lifecycle script "${key}" added or changed: ${next}`);
      }
    }
    for (const key of ['start', 'dev', 'prestart', 'predev']) {
      const next = after?.scripts?.[key];
      const previous = before?.scripts?.[key];
      if (next && next !== previous && /\bapi\.js\b/.test(next)) {
        add('error', file, null, `"${key}" script executes api.js`);
      }
    }
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [dependency, version] of Object.entries(after?.[section] || {})) {
        if (typeof version === 'string' && /^(?:git\+)?(?:https?|ssh):|^file:/.test(version)) {
          add('warning', file, null, `${section}.${dependency} uses a non-registry source: ${version}`);
        }
      }
    }
    continue;
  }

  if (LOCKFILES.test(file)) continue;

  const text = show(HEAD, file);
  if (text === null) continue;
  if (text.length > MAX_SCAN_BYTES) {
    add('warning', file, null, `file larger than ${MAX_SCAN_BYTES} bytes; skipped deep scan`);
    continue;
  }

  if (CONFIG.test(file)) {
    const cjkLine = firstLine(text, CJK);
    if (cjkLine) add('error', file, cjkLine, 'non-ASCII code found in a config file');
    const appended = appendedConfigBlock(text);
    if (appended) add('error', file, appended, 'code block appended after a long run of blank lines');
  }

  if (CODE.test(file) && !I18N.test(file) && !TEST.test(file)) {
    const hangulLine = firstLine(text, HANGUL);
    if (hangulLine) add('error', file, hangulLine, 'Hangul characters injected into source code');
    else {
      const cjkLine = firstLine(text, CJK);
      if (cjkLine) add('warning', file, cjkLine, 'non-ASCII characters in source code; verify they are intentional');
    }
    if (/curl[^\n|]*\|\s*(?:ba)?sh|wget[^\n|]*\|\s*(?:ba)?sh|base64\s+-d[^\n|]*\|\s*(?:ba)?sh/i.test(text)) {
      add('error', file, null, 'remote content piped into a shell');
    }
    const hasExec = /child_process|execSync|spawnSync|execFileSync|execFile\s*\(|spawn\s*\(/.test(text);
    if (hasExec && /\b(?:curl|wget)\b/i.test(text)) {
      add('error', file, null, 'process execution combined with curl/wget');
    } else if (hasExec && /\b(?:fetch|axios)\s*\(|https?\.request/.test(text)) {
      add('warning', file, null, 'process execution combined with network calls; verify');
    }
    const hasDecode = /\batob\s*\(|Buffer\.from\([^)]*['"]base64['"]|base64\s+-d/.test(text);
    if (hasDecode && (DYNAMIC_CODE.test(text) || hasExec)) {
      add('error', file, null, 'base64 decoding combined with eval or process execution');
    } else if (DYNAMIC_CODE.test(text)) {
      add('warning', file, null, 'dynamic code evaluation found; verify');
    }
    if (/\.ssh\/|id_rsa|id_ed25519/.test(text) && /\b(?:fetch|axios|https?)\b/.test(text)) {
      add('error', file, null, 'SSH key access combined with network calls');
    }
  }
}

const errors = findings.filter((finding) => finding.level === 'error');
const warnings = findings.filter((finding) => finding.level === 'warning');
for (const finding of findings) annotation(finding.level, finding.file, finding.line, finding.message);

console.log(`IOC scan: ${files.length} changed file(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
if (errors.length > 0) {
  console.log('Blocking merge: resolve the errors above or have a maintainer review and bypass the check.');
  process.exit(1);
}
