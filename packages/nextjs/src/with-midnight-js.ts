/*
 * This file is part of midnight-js.
 * Copyright (C) 2025-2026 Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { NextConfig } from 'next';

/**
 * WASM packages from the @midnight-ntwrk ecosystem whose server-side loader
 * uses readFileSync with a runtime __dirname path.  Bundling them server-side
 * breaks that path resolution, so we keep them external (loaded natively by
 * Node.js) on the server.
 */
const MIDNIGHT_WASM_PACKAGES = [
  '@midnight-ntwrk/ledger-v8',
  '@midnight-ntwrk/onchain-runtime-v3',
  '@midnight-ntwrk/zkir-v2',
] as const;

/**
 * Wraps a Next.js configuration object to add full midnight-js compatibility.
 *
 * ---
 * ### webpack  (`next build` / `next dev --webpack`)
 *
 * Enables the `asyncWebAssembly` experiment so that all `@midnight-ntwrk`
 * packages built with `wasm-bindgen --target bundler` resolve correctly
 * without any extra flags.
 *
 * ---
 * ### Turbopack  (`next dev` / `next dev --turbopack` / `next build --turbopack`)
 *
 * Turbopack does **not** support the static ESM WASM import pattern
 * (`import * as wasm from "*.wasm"`) that the wasm-bindgen bundler target
 * produces.  You must run the WASM patch script once after every install:
 *
 * ```bash
 * # npx / yarn dlx / pnpm dlx
 * node node_modules/@midnight-ntwrk/midnight-js-nextjs/scripts/patch-wasm-turbopack.mjs
 * ```
 *
 * Or add it to your project's `postinstall` lifecycle hook:
 *
 * ```json
 * {
 *   "scripts": {
 *     "postinstall": "midnight-patch-wasm"
 *   }
 * }
 * ```
 *
 * The script rewrites the browser WASM loader inside each installed
 * `@midnight-ntwrk` WASM package, replacing the static import with a
 * `new URL() + fetch + WebAssembly.instantiateStreaming` call that both
 * Turbopack **and** webpack 5 understand as a static asset reference.
 *
 * ---
 * @param nextConfig - Your existing Next.js configuration (may be empty).
 * @returns A merged Next.js configuration with midnight-js compatibility.
 *
 * @example
 * ```ts
 * // next.config.ts
 * import { withMidnightJs } from '@midnight-ntwrk/midnight-js-nextjs';
 * import type { NextConfig } from 'next';
 *
 * const nextConfig: NextConfig = {};
 *
 * export default withMidnightJs(nextConfig);
 * ```
 */
export function withMidnightJs(nextConfig: NextConfig = {}): NextConfig {
  return {
    ...nextConfig,

    // Keep the WASM packages out of the server bundle.  Their Node.js loader
    // (midnight_*_wasm_fs.js) resolves the .wasm path with __dirname at
    // runtime — correct when Node.js loads the package natively, broken when
    // a bundler tries to inline it.
    serverExternalPackages: [
      ...(nextConfig.serverExternalPackages ?? []),
      ...MIDNIGHT_WASM_PACKAGES,
    ],

    webpack(config, options) {
      if (!options.isServer) {
        // The @midnight-ntwrk WASM packages are published with the
        // wasm-bindgen --target bundler output which relies on webpack's
        // WebAssembly ESM Integration experiment.  Enable it here so users
        // get a working build without any manual config when using webpack.
        //
        // Turbopack does not support this experiment — use the patch script
        // described in the JSDoc above instead.
        config.experiments = {
          ...config.experiments,
          asyncWebAssembly: true,
        };
      }

      // Chain the user's own webpack customisations, if any.
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options);
      }

      return config;
    },
  };
}
