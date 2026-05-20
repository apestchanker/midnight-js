# Troubleshooting

Common issues and solutions when developing with Midnight.js.

## Node.js Version Issues

### Wrong Node Version

**Symptom:** Build or runtime errors mentioning unsupported syntax or APIs.

**Solution:**
```bash
# Check current version
node -v

# Switch to correct version
nvm use

# If version not installed
nvm install
```

### Node Version Not Found

**Symptom:** `N/A: version "X" is not yet installed`

**Solution:**
```bash
nvm install
nvm use
```

### Corepack Not Enabled

**Symptom:** `yarn: command not found` or wrong Yarn version.

**Solution:**
```bash
corepack enable
```

## direnv Setup

### What direnv Does

The `.envrc` file automatically:
- Sets `COMPACTC_VERSION` environment variable
- Activates correct Node.js version via nvm
- Configures GPG signing for commits

### Installation

```bash
# macOS
brew install direnv

# Ubuntu/Debian
sudo apt install direnv

# Add to shell (bash)
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc

# Add to shell (zsh)
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
```

### direnv Not Loading

**Symptom:** Environment variables not set, wrong Node version.

**Solution:**
```bash
# Allow direnv for this directory
direnv allow

# Check status
direnv status
```

### Working Without direnv

If you prefer not to use direnv, manually set environment:

```bash
export COMPACTC_VERSION=0.29.0
nvm use
git config --local commit.gpgSign true
git config --local tag.gpgSign true
```

## Build Failures

### Stale Build Artifacts

**Symptom:** Type errors or runtime errors after pulling changes.

**Solution:**
```bash
yarn clean
yarn build
```

### TypeScript Errors After Dependency Update

**Symptom:** Type errors in node_modules or dependency mismatches.

**Solution:**
```bash
rm -rf node_modules
yarn install
yarn clean-build
```

### Turbo Cache Issues

**Symptom:** Changes not reflected after build.

**Solution:**
```bash
# Force rebuild ignoring cache
yarn turbo run build --force
```

### Out of Memory During Build

**Symptom:** `JavaScript heap out of memory`

**Solution:**
```bash
NODE_OPTIONS=--max-old-space-size=8192 yarn build
```

## Test Failures

### Integration Tests Require Docker

**Symptom:** Integration tests fail with connection errors.

**Cause:** Integration tests require Docker services running.

**Solution:**
```bash
# Start Docker and required services
cd testkit-js
docker compose up -d

# Verify services are healthy
docker compose ps
```

### Vitest Timeout Errors

**Symptom:** `Test timed out after 90000ms`

**Solution:**
```bash
# Increase timeout for specific test
cd packages/<package>
yarn vitest --testTimeout=180000
```

### Tests Hang Indefinitely

**Symptom:** Tests start but never complete.

**Cause:** Often unresolved promises or missing mocks.

**Solution:**
```bash
# Run with verbose output
yarn vitest --reporter=verbose
```

## Git Hook Issues

### GPG Signing Failures

**Symptom:** `error: gpg failed to sign the data`

**Solutions:**

1. **GPG not configured:**
   ```bash
   # List keys
   gpg --list-secret-keys --keyid-format=long

   # Configure Git to use key
   git config --global user.signingkey <KEY_ID>
   ```

2. **GPG agent not running:**
   ```bash
   gpgconf --launch gpg-agent
   ```

3. **TTY issues:**
   ```bash
   export GPG_TTY=$(tty)
   ```

4. **Temporarily disable signing:**
   ```bash
   git commit --no-gpg-sign -m "message"
   ```

### Pre-push Hook Slow

**Symptom:** `git push` takes a long time.

**Cause:** Pre-push runs full lint and typecheck.

**Workaround (use sparingly):**
```bash
git push --no-verify
```

### Commit Message Rejected

**Symptom:** `commitlint` error on commit.

**Cause:** Commit message doesn't follow [Conventional Commits](https://www.conventionalcommits.org/).

**Solution:** Use correct format:
```bash
# Format
<type>(<scope>): <description>

# Examples
git commit -m "feat(contracts): add batch deployment"
git commit -m "fix(utils): handle empty input"
git commit -m "docs: update README"

# Or use interactive commit
yarn commit
```

**Valid types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`

### Lint-Staged Errors

**Symptom:** Pre-commit fails with lint errors.

**Solution:**
```bash
# Auto-fix issues
yarn lint:fix

# Then commit again
git add .
git commit -m "message"
```

## Common Errors

### `Cannot find module '@midnight-ntwrk/...'`

**Cause:** Package not built or dependency not linked.

**Solution:**
```bash
yarn build
```

### `ERR_MODULE_NOT_FOUND` for Local Packages

**Cause:** Workspace resolution issue.

**Solution:**
```bash
rm -rf node_modules
yarn install
yarn build
```

### `ENOENT: no such file or directory` During Build

**Cause:** Missing build output from dependency.

**Solution:**
```bash
# Build with dependencies
yarn turbo run build --filter=@midnight-ntwrk/midnight-js-<package>...
```

### Type Errors: `Property 'X' does not exist`

**Cause:** TypeScript declarations out of sync.

**Solution:**
```bash
yarn clean
yarn build
```

### `COMPACTC_VERSION is not set`

**Cause:** Environment variable not configured.

**Solution:**
```bash
# With direnv
direnv allow

# Without direnv
export COMPACTC_VERSION=0.29.0
```

### Docker Compose Service Unhealthy

**Symptom:** `container is unhealthy` errors.

**Solution:**
```bash
cd testkit-js

# Check logs
docker compose logs <service-name>

# Restart services
docker compose down
docker compose up -d

# Wait for healthy status
docker compose ps
```

## Getting Help

If issues persist:

1. Check existing [GitHub Issues](https://github.com/midnightntwrk/midnight-js/issues)
2. Open a new issue with:
   - Node version (`node -v`)
   - Yarn version (`yarn -v`)
   - OS and version
   - Full error message
   - Steps to reproduce

---

## Turbopack / Next.js Bundler Issues

### "Cannot import WASM" or "Unexpected token" with Turbopack

**Symptom:** Running `next dev` (Turbopack, the default since Next.js 15) throws
an error like:

```
Error: Cannot find module '@midnight-ntwrk/ledger-v8'
./node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm.js
import * as wasm from "./midnight_ledger_wasm_bg.wasm"
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
SyntaxError: Unexpected token
```

or

```
⨯ Error [ModuleNotFoundError]: Cannot find module 'midnight_ledger_wasm_bg.wasm'
```

**Root cause:** The `@midnight-ntwrk` WASM packages (`ledger-v8`,
`onchain-runtime-v3`, `zkir-v2`) are published with the `wasm-bindgen
--target bundler` browser loader, which contains:

```js
import * as wasm from "./midnight_ledger_wasm_bg.wasm";
```

This is the [WebAssembly ESM Integration
proposal](https://github.com/WebAssembly/esm-integration) — supported by
webpack 5 via `experiments.asyncWebAssembly`, but **not yet supported by
Turbopack** (tracked upstream at
[vercel/next.js#65887](https://github.com/vercel/next.js/issues/65887)).

---

### Quick fix: use the webpack bundler temporarily

Pass the `--webpack` flag to fall back to webpack while the Turbopack issue is
resolved upstream:

```bash
next dev --webpack
```

If you use `withMidnightJs()` (see below) the webpack path is already configured
for you — no additional flags or config are needed.

---

### Permanent fix: patch the WASM loaders for Turbopack

Install the Next.js integration helper:

```bash
yarn add @midnight-ntwrk/midnight-js-nextjs
# or
npm install @midnight-ntwrk/midnight-js-nextjs
```

Wrap your `next.config.ts`:

```ts
// next.config.ts
import { withMidnightJs } from '@midnight-ntwrk/midnight-js-nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // your existing config
};

export default withMidnightJs(nextConfig);
```

Then run the WASM patch script once after every install:

```bash
node node_modules/@midnight-ntwrk/midnight-js-nextjs/scripts/patch-wasm-turbopack.mjs
```

Or add it as a `postinstall` hook so it runs automatically:

```json
{
  "scripts": {
    "postinstall": "midnight-patch-wasm"
  }
}
```

**What the patch does:** Each WASM package ships a Node.js loader
(`midnight_*_wasm_fs.js`) that already has the correct import/snippet wiring
for the WASM binary. The script copies that wiring into the browser loader but
replaces `readFileSync` with `fetch(new URL('./pkg_bg.wasm', import.meta.url))` —
a static-asset reference pattern that **both Turbopack and webpack 5 support**.

**What does NOT change:** the `.wasm` binary itself, the JS type exports, or
any calling code. The patch is idempotent — safe to re-run on every install.

---

### Why `withMidnightJs()` instead of manual config?

`withMidnightJs()` adds two things:

| Setting | Effect |
|---|---|
| `webpack.experiments.asyncWebAssembly` | Enables the WASM ESM experiment for the client bundle when using webpack. Already on by default in Next.js, but set explicitly as a safety net in case other webpack plugins reset `experiments`. |
| `serverExternalPackages` | Prevents Next.js from bundling the WASM packages server-side. Their Node.js loader uses `readFileSync` with a runtime `__dirname` path — correct when Node.js loads the package natively, broken when a bundler inlines it. |

---

### Long-term fix (upstream)

The definitive solution is to update the artifacts repo to publish the WASM
packages with `wasm-pack --target web` output (an async `init()` function
using `fetch + WebAssembly.instantiateStreaming`) instead of `--target bundler`
(static ESM WASM import).  An issue has been filed with the Midnight Foundation
artifacts team.  Until that ships, the patch script is the recommended approach.
