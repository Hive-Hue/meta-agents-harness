---
name: env-setup
description: Prepare the local development environment for MAH Mobile Control Plane — installs Node.js runtime, checks Expo SDK, sets up TypeScript, validates dependencies, and scaffolds the host API + mobile app project directories. Use before any crew task execution.
compatibility: [hermes]
---

# Env Setup — MAH Mobile Control Plane

Use this skill when preparing the development environment before crew execution begins. Run once at the start of a session or when bootstrapping a fresh clone.

## When to Use

- Fresh clone of `mah-mobile` repo
- New development session after `git pull`
- After `npm install` or dependency changes
- Before running `mah run --crew mah-mobile`

## Environment Requirements

| Tool | Required Version | Purpose |
|------|----------------|---------|
| Node.js | ≥ 20.x | Host API runtime |
| npm | ≥ 10.x | Package management |
| Expo SDK | ≥ 52 | Mobile app framework |
| TypeScript | ≥ 5.x | API and mobile code |
| Xcode | ≥ 15 | iOS simulator (macOS only) |
| Android Studio | Latest | Android emulator |
| OpenSSL | 3.x | TLS for dev server |

## Step 1 — Node.js and Package Manager

```bash
node --version  # must be ≥ 20.0.0
npm --version   # must be ≥ 10.0.0
```

If using nvm:
```bash
nvm install 20
nvm use 20
```

## Step 2 — Repo Dependencies

```bash
cd /home/alysson/Github/mah-mobile

# Install host API dependencies
cd api && npm install
cd ..

# Install mobile app dependencies
cd mobile-app && npx expo install
cd ..
```

## Step 3 — TypeScript Configuration

Verify `api/tsconfig.json` exists. If not, generate:

```bash
cd api && npx tsc --init --target ES2022 --module commonjs --outDir ./dist --rootDir ./src --strict --esModuleInterop
```

Verify `mobile-app/tsconfig.json` exists. If using Expo, it is auto-generated on `npx create-expo-app`.

## Step 4 — Environment Variables

Create `.env` files:

**`api/.env`** (host API):
```
PORT=3000
MAH_HOST_ID=local-dev
MAH_WORKSPACE=/home/alysson/Github/mah-mobile
HERMES_GATEWAY_URL=http://localhost:3001
SSE_KEEPALIVE_INTERVAL=30000
JWT_SECRET=dev-secret-change-in-production
```

**`mobile-app/.env`** (mobile app):
```
API_BASE_URL=http://<your-host-ip>:3000
MAH_MOBILE_SCHEME=mahmobile
```

## Step 5 — Hermes Gateway Check

Verify Hermes Gateway is reachable:

```bash
curl -s http://localhost:3001/api/mah/hermes-gateway/health | head -c 200
```

If not running, start it:
```bash
cd /home/alysson/Github/meta-agents-harness
npm run dev:hermes-gateway &
```

## Step 6 — Directory Structure Validation

```bash
# Verify all required dirs exist
for dir in api/src mobile-app infrastructure tests/unit/api tests/unit/streaming tests/unit/rbac tests/integration tests/security docs; do
  if [ ! -d "$dir" ]; then
    echo "MISSING: $dir"
  fi
done
echo "Structure check complete"
```

## Step 7 — Dependency Tree Validation

```bash
cd api && npm ls --depth=0 2>&1 | head -20
cd ../mobile-app && npm ls --depth=0 2>&1 | head -20
```

Expected packages for `api`:
- express
- cors
- helmet
- jsonwebtoken
- bcryptjs
- uuid
- dotenv
- typescript (dev)
- jest (dev)
- supertest (dev)
- @types/* (dev)

Expected packages for `mobile-app` (Expo SDK 52+):
- expo
- expo-av
- @react-navigation/native
- @react-navigation/bottom-tabs
- @react-navigation/stack
- react-native-sse (or custom EventSource)
- zustand
- @react-native-async-storage/async-storage

## Step 8 — Generate TLS Certificates (Dev)

```bash
# Create certs for local HTTPS
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"
```

## Step 9 — Write health check script

**`scripts/dev-check.sh`**:
```bash
#!/bin/bash
set -e

echo "=== MAH Mobile Dev Environment Check ==="

echo "[1/6] Node version:"
node --version

echo "[2/6] NPM version:"
npm --version

echo "[3/6] API dependencies:"
cd api && npm ls --depth=0 2>&1 | grep -E "express|typescript|jest" || echo "  Some deps missing - run npm install"

echo "[4/6] Mobile app:"
cd ../mobile-app && ls package.json > /dev/null && echo "  package.json found" || echo "  MISSING package.json"

echo "[5/6] Directory structure:"
for dir in api/src mobile-app/src infrastructure tests docs; do
  [ -d "$dir" ] && echo "  ✓ $dir" || echo "  ✗ $dir MISSING"
done

echo "[6/6] Hermes Gateway:"
curl -s --max-time 3 http://localhost:3001/api/mah/hermes-gateway/health > /dev/null 2>&1 && echo "  ✓ reachable" || echo "  ✗ not running (start with: cd /home/alysson/Github/meta-agents-harness && npm run dev:hermes-gateway)"

echo "=== Check complete ==="
```

## Step 10 — Final Validation

```bash
cd /home/alysson/Github/mah-mobile
mah validate:config
mah list:crews
```

Expected:
- `validate:config` → PASSED
- `list:crews` → `crew=mah-mobile active=true`

## Troubleshooting

### `npm install` fails
```bash
cd api
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### Expo doctor fails
```bash
cd mobile-app
npx expo doctor --fix
```

### Hermes Gateway not starting
```bash
cd /home/alysson/Github/meta-agents-harness
npm run dev:hermes-gateway 2>&1 | head -50
```

### Port conflicts
```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
```

## Verification Checklist

After running this skill, confirm:
- [ ] Node.js ≥ 20 and npm ≥ 10
- [ ] `api/node_modules` installed
- [ ] `mobile-app/node_modules` installed (or Expo prebuild done)
- [ ] `.env` files present in `api/` and `mobile-app/`
- [ ] TypeScript configs exist
- [ ] All project directories present
- [ ] Hermes Gateway reachable or instructions to start it
- [ ] `mah validate:config` passes