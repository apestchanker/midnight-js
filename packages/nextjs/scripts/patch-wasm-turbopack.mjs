#!/usr/bin/env node
/**
 * patch-wasm-turbopack.mjs
 *
 * Patches @midnight-ntwrk WASM packages so their browser loader is compatible
 * with Turbopack (Next.js ≥ 15 default bundler).
 *
 * WHY THIS IS NEEDED
 * ------------------
 * The @midnight-ntwrk WASM packages (ledger-v8, onchain-runtime-v3, zkir-v2)
 * are compiled with `wasm-pack --target bundler`.  That target's browser
 * loader contains:
 *
 *   import * as wasm from "./pkg_bg.wasm";
 *
 * This is the WebAssembly ESM Integration proposal — supported by webpack 5
 * via `experiments.asyncWebAssembly`, but NOT yet supported by Turbopack
 * (tracked at https://github.com/vercel/next.js/issues/65887).
 *
 * HOW THE PATCH WORKS
 * -------------------
 * Each package ships two loaders:
 *   • midnight_*_wasm.js    — browser (bundler target, uses static WASM import)
 *   • midnight_*_wasm_fs.js — Node.js (uses readFileSync + __dirname)
 *
 * The Node.js loader already contains the correct wasm-bindgen imports object
 * (listing all JS modules and snippet files the WASM binary needs).  We reuse
 * that structure and replace only the three Node.js-specific parts:
 *
 *   readFileSync  →  fetch(new URL('./pkg_bg.wasm', import.meta.url))
 *   WebAssembly.Module(bytes) + WebAssembly.Instance(mod, imports)
 *     →  WebAssembly.instantiateStreaming(response, imports)
 *
 * `new URL('*.wasm', import.meta.url)` is a static asset reference that both
 * webpack 5 and Turbopack understand — they emit the .wasm as a separate
 * chunk and resolve the URL at runtime from the same origin.
 *
 * SECURITY & PERFORMANCE
 * ----------------------
 * • The .wasm binary is unchanged — same bytes, same sandbox.
 * • new URL() resolves to the same origin (no external fetch risk).
 * • WebAssembly.instantiateStreaming compiles while streaming, which is
 *   faster and uses less peak memory than buffering first.
 * • Top-level await (used in the new loader) is transparent to importers —
 *   the module system waits before making exports available, same effective
 *   behaviour as the previous synchronous bundler-handled initialisation.
 * • CSP requirements are identical: both approaches need `wasm-unsafe-eval`.
 *
 * USAGE
 * -----
 * Run once after every yarn/npm/pnpm install:
 *
 *   node node_modules/@midnight-ntwrk/midnight-js-nextjs/scripts/patch-wasm-turbopack.mjs
 *
 * Or via the bin alias:
 *
 *   npx midnight-patch-wasm
 *
 * Or as a postinstall hook in your project's package.json:
 *
 *   "scripts": { "postinstall": "midnight-patch-wasm" }
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve packages relative to the project root (where node_modules lives),
// not relative to this script's location inside node_modules.
const projectRoot = process.env.INIT_CWD ?? process.cwd();
const require = createRequire(join(projectRoot, 'package.json'));

// ---------------------------------------------------------------------------
// WASM package descriptors
// ---------------------------------------------------------------------------
const WASM_PACKAGES = [
  {
    pkg: '@midnight-ntwrk/ledger-v8',
    prefix: 'midnight_ledger_wasm',
  },
  {
    pkg: '@midnight-ntwrk/onchain-runtime-v3',
    prefix: 'midnight_onchain_runtime_wasm',
  },
  {
    pkg: '@midnight-ntwrk/zkir-v2',
    prefix: 'midnight_zkir_wasm',
  },
];

// ---------------------------------------------------------------------------
// Transform: Node.js fs loader → browser fetch loader
// ---------------------------------------------------------------------------

/**
 * Transforms the content of a `*_wasm_fs.js` (Node.js) loader into a
 * browser-compatible fetch loader suitable for Turbopack.
 *
 * The transformation is purely mechanical — we strip the three Node.js-
 * specific APIs and replace the synchronous WASM instantiation with an
 * equivalent async fetch-based one.
 *
 * @param {string} src     - Full source text of the *_fs.js loader.
 * @param {string} prefix  - e.g. "midnight_ledger_wasm"
 * @returns {string}       - Transformed browser loader source.
 */
function transformFsLoader(src, prefix) {
  const wasmBgFilename = `${prefix}_bg.wasm`;

  let out = src;

  // 1. Remove Node.js-only imports ─────────────────────────────────────────
  out = out.replace(/^\s*import \{ readFileSync \} from ['"]fs['"];\s*\n/m, '');
  out = out.replace(/^\s*import \{ join, dirname \} from ['"]path['"];\s*\n/m, '');
  out = out.replace(/^\s*import \{ fileURLToPath \} from ['"]url['"];\s*\n/m, '');

  // 2. Remove __filename / __dirname setup ──────────────────────────────────
  out = out.replace(/^\s*const __filename\s*=\s*fileURLToPath\(import\.meta\.url\);\s*\n/m, '');
  out = out.replace(/^\s*const __dirname\s*=\s*dirname\(__filename\);\s*\n/m, '');

  // 3. Remove wasmPath + bytes reads ────────────────────────────────────────
  //    Matches:  const wasmPath = join(__dirname, '...anything....wasm');
  out = out.replace(/^\s*const wasmPath\s*=\s*join\(__dirname,\s*'[^']*\.wasm'\);\s*\n/m, '');
  out = out.replace(/^\s*const bytes\s*=\s*readFileSync\(wasmPath\);\s*\n/m, '');

  // 4. Replace synchronous WebAssembly creation with streaming fetch ─────────
  //
  //    Old (two lines):
  //      const wasmModule   = new WebAssembly.Module(bytes);
  //      const wasmInstance = new WebAssembly.Instance(wasmModule, imports);
  //
  //    New (three lines, top-level await — valid in ESM):
  //      const wasmUrl      = new URL('./prefix_bg.wasm', import.meta.url);
  //      const wasmResponse = await fetch(wasmUrl);
  //      const { instance: wasmInstance } = await WebAssembly.instantiateStreaming(wasmResponse, imports);
  //
  out = out.replace(
    /^\s*const wasmModule\s*=\s*new WebAssembly\.Module\(bytes\);\s*\n\s*const wasmInstance\s*=\s*new WebAssembly\.Instance\(wasmModule,\s*imports\);\s*\n/m,
    [
      `  // Turbopack-compatible WASM loader — replaces wasm-bindgen bundler-target`,
      `  // static import. new URL() is a static asset reference understood by both`,
      `  // webpack 5 and Turbopack. See: https://github.com/vercel/next.js/issues/65887`,
      `  const wasmUrl = new URL('./${wasmBgFilename}', import.meta.url);`,
      `  const wasmResponse = await fetch(wasmUrl);`,
      `  const { instance: wasmInstance } = await WebAssembly.instantiateStreaming(wasmResponse, imports);`,
      ``,
    ].join('\n'),
  );

  // 5. Add a header comment so humans know the file was patched ─────────────
  const header = [
    `// PATCHED by @midnight-ntwrk/midnight-js-nextjs patch-wasm-turbopack script.`,
    `// This browser loader has been rewritten for Turbopack compatibility.`,
    `// Original loader used: import * as wasm from "./${wasmBgFilename}" (webpack-only).`,
    `// See packages/nextjs/scripts/patch-wasm-turbopack.mjs for details.`,
    ``,
  ].join('\n');

  return header + out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let patched = 0;
let skipped = 0;

for (const { pkg, prefix } of WASM_PACKAGES) {
  // ── Locate the installed package ─────────────────────────────────────────
  let pkgDir;
  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    pkgDir = dirname(pkgJsonPath);
  } catch {
    console.log(`  SKIP  ${pkg} — not installed`);
    skipped++;
    continue;
  }

  const fsLoaderPath = join(pkgDir, `${prefix}_fs.js`);
  const browserLoaderPath = join(pkgDir, `${prefix}.js`);

  if (!existsSync(fsLoaderPath)) {
    console.log(`  SKIP  ${pkg} — fs loader not found (unexpected package layout)`);
    skipped++;
    continue;
  }

  // ── Bail out if already patched (idempotent) ──────────────────────────────
  const existing = existsSync(browserLoaderPath) ? readFileSync(browserLoaderPath, 'utf8') : '';
  if (existing.includes('PATCHED by @midnight-ntwrk/midnight-js-nextjs')) {
    console.log(`  OK    ${pkg} — already patched`);
    skipped++;
    continue;
  }

  // ── Apply transform ───────────────────────────────────────────────────────
  const fsSource = readFileSync(fsLoaderPath, 'utf8');
  const browserSource = transformFsLoader(fsSource, prefix);
  writeFileSync(browserLoaderPath, browserSource, 'utf8');

  // ── Ensure the package.json exports have a "default" condition ───────────
  // Turbopack may not match "browser" in some render contexts; "default" is
  // the safe fallback.  We only add it if missing — no other fields change.
  const pkgJsonPath = join(pkgDir, 'package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const exports = pkgJson.exports ?? {};

  let pkgJsonDirty = false;

  // Root export (object with conditions)
  if (exports['.'] && typeof exports['.'] === 'object' && !exports['.'].default) {
    exports['.'].default = exports['.'].browser ?? `./${prefix}.js`;
    pkgJsonDirty = true;
  }
  // Flat export (conditions at root level, no sub-path key)
  if (!exports['.'] && !exports.default) {
    exports.default = exports.browser ?? `./${prefix}.js`;
    pkgJsonDirty = true;
  }

  if (pkgJsonDirty) {
    pkgJson.exports = exports;
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
    console.log(`  PATCH ${pkg} — browser loader rewritten + "default" export added`);
  } else {
    console.log(`  PATCH ${pkg} — browser loader rewritten`);
  }

  patched++;
}

console.log('');
console.log(`Done. ${patched} package(s) patched, ${skipped} skipped.`);
if (patched > 0) {
  console.log('You can now use next dev (Turbopack) without the --webpack flag.');
}
