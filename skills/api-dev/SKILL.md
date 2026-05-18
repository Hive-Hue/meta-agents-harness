---
name: api-dev
description: Development workflow for the MAH Mobile host-side API layer — Express/TypeScript server implementing all 10 mobile API namespaces (auth, devices, sessions, runs, approvals, artifacts, files, terminal, targets, voice), RBAC middleware, audit logging, and Hermes Gateway integration.
compatibility: [hermes]
---

# API Dev — MAH Mobile Control Plane

Use this skill when implementing or modifying the host-side API at `/home/alysson/Github/mah-mobile/api/`.

## When to Use

- Implementing any of the 10 mobile API namespaces
- Adding RBAC middleware to an endpoint
- Integrating a new endpoint with Hermes Gateway
- Writing unit or integration tests for the API

## Project Structure

```
api/
├── src/
│   ├── index.ts              # Express app entry
│   ├── config.ts             # Environment config
│   ├── auth/
│   │   ├── router.ts         # Auth routes
│   │   ├── middleware.ts     # JWT + RBAC middleware
│   │   ├── pairing.ts       # Device pairing logic
│   │   └── tokens.ts        # Token issuance/rotation
│   ├── devices/
│   │   └── router.ts         # Device registry
│   ├── sessions/
│   │   └── router.ts         # Session list/resume
│   ├── runs/
│   │   └── router.ts         # Run lifecycle
│   ├── approvals/
│   │   └── router.ts         # Approval queue
│   ├── artifacts/
│   │   └── router.ts         # Artifact browsing
│   ├── files/
│   │   ├── router.ts         # File browse/diff
│   │   └── patch.ts          # FilePatchRequest lifecycle
│   ├── terminal/
│   │   └── router.ts         # Terminal stream
│   ├── targets/
│   │   └── router.ts         # Remote target registry
│   └── voice/
│       └── router.ts         # Voice input/TTS
├── tests/
│   ├── unit/api/             # Endpoint unit tests
│   ├── unit/rbac/            # RBAC enforcement tests
│   └── integration/          # API integration tests
├── package.json
└── tsconfig.json
```

## All 10 API Namespaces

| Namespace | Base Path | Purpose |
|-----------|-----------|---------|
| auth | `/api/mah/mobile/auth/*` | Device pairing, token lifecycle |
| devices | `/api/mah/mobile/devices/*` | Device registry, revocation |
| sessions | `/api/mah/mobile/sessions/*` | Session list, resume, new |
| runs | `/api/mah/mobile/runs/*` | Run lifecycle, detail, stream |
| approvals | `/api/mah/mobile/approvals/*` | Queue, approve, deny, expire |
| artifacts | `/api/mah/mobile/artifacts/*` | Artifact browsing |
| files | `/api/mah/mobile/files/*` | Browse, diff, patch |
| terminal | `/api/mah/mobile/terminal/*` | Terminal stream |
| targets | `/api/mah/mobile/targets/*` | Remote target registry, execute |
| voice | `/api/mah/mobile/voice/*` | Transcript input, TTS output |

## Auth Middleware Pattern

Every endpoint must go through auth middleware:

```typescript
// src/auth/middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  deviceSession?: {
    deviceId: string;
    userId: string;
    hostId: string;
    role: 'viewer' | 'operator' | 'admin';
  };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthRequest['deviceSession'];
    req.deviceSession = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.deviceSession) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.deviceSession.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
```

## Audit Middleware Pattern

Every mobile request must be logged:

```typescript
// src/auth/audit.ts
export function auditLog(action: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const { deviceId, userId, hostId, role } = req.deviceSession || {};
    const entry = {
      timestamp: new Date().toISOString(),
      actor: userId,
      device: deviceId,
      host: hostId,
      role,
      action,
      path: req.path,
      method: req.method,
      outcome: 'pending',
    };
    // Log to audit store (file, DB, or external service)
    console.log('[AUDIT]', JSON.stringify(entry));
    next();
  };
}
```

## Express App Entry Pattern

```typescript
// src/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authenticate } from './auth/middleware';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Health check (no auth)
app.get('/api/mah/mobile/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// All mobile API routes require auth
app.use('/api/mah/mobile', authenticate);

// Mount namespaces
app.use('/api/mah/mobile/auth', authRouter);
app.use('/api/mah/mobile/devices', devicesRouter);
app.use('/api/mah/mobile/sessions', sessionsRouter);
app.use('/api/mah/mobile/runs', runsRouter);
app.use('/api/mah/mobile/approvals', approvalsRouter);
app.use('/api/mah/mobile/artifacts', artifactsRouter);
app.use('/api/mah/mobile/files', filesRouter);
app.use('/api/mah/mobile/terminal', terminalRouter);
app.use('/api/mah/mobile/targets', targetsRouter);
app.use('/api/mah/mobile/voice', voiceRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MAH Mobile API running on port ${PORT}`);
});
```

## RBAC Matrix

| Action | viewer | operator | admin |
|--------|--------|----------|-------|
| GET /sessions | ✓ (own/shared) | ✓ | ✓ |
| POST /sessions/resume | ✗ | ✓ | ✓ |
| POST /runs | ✗ | ✓ | ✓ |
| GET /runs/:id | ✓ | ✓ | ✓ |
| POST /approvals/:id/approve | ✗ | ✓ | ✓ |
| DELETE /devices/:id | ✗ | ✗ | ✓ |
| GET /files/browse | ✓ | ✓ | ✓ |
| POST /files/patch | ✗ | ✓ | ✓ |
| POST /targets/:id/execute | ✗ | ✓ | ✓ |

## SSE Streaming Pattern

For run and terminal streaming, use Express SSE:

```typescript
import { Router } from 'express';

export const runsRouter = Router();

runsRouter.get('/:runId/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Subscribe to run events
  const unsubscribe = runEventEmitter.subscribe(runId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
  });
});
```

## Hermes Gateway Integration

For chat/voice routing:

```typescript
import { hermesGateway } from '../infrastructure/hermes-gateway-adapter/client';

runsRouter.post('/:runId/chat', async (req, res) => {
  const { message } = req.body;
  const result = await hermesGateway.chat(message, {
    sessionId: req.params.runId,
    deviceId: req.deviceSession?.deviceId,
  });
  res.json(result);
});
```

## Testing Pattern

```typescript
// tests/unit/api/sessions.test.ts
import request from 'supertest';
import { app } from '../../src/index';

describe('Sessions API', () => {
  it('GET /sessions returns 401 without token', async () => {
    const res = await request(app).get('/api/mah/mobile/sessions');
    expect(res.status).toBe(401);
  });

  it('GET /sessions returns session list with valid token', async () => {
    const token = jwt.sign({ deviceId: 'dev', userId: 'user', hostId: 'host', role: 'admin' }, process.env.JWT_SECRET!);
    const res = await request(app)
      .get('/api/mah/mobile/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('viewer cannot call POST /sessions/resume', async () => {
    const token = jwt.sign({ deviceId: 'dev', userId: 'user', hostId: 'host', role: 'viewer' }, process.env.JWT_SECRET!);
    const res = await request(app)
      .post('/api/mah/mobile/sessions/test-session/resume')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
```

## Key Constraints

1. **Phone never is runtime host** — all execution stays on host
2. **RBAC from v1** — every endpoint checks role before execution
3. **Audit from v1** — every mobile request logged with full attribution
4. **SSE minimum** — streaming works over SSE with reconnect-safe offset
5. **Reuse MAH APIs** — promote/wrap existing Hermes Gateway endpoints

## Verification

After implementing any API namespace:
- [ ] All endpoints respond (even if returning mock data initially)
- [ ] Auth middleware rejects requests without token (401)
- [ ] RBAC middleware rejects viewer on operator/admin endpoints (403)
- [ ] Audit log entries created for every request
- [ ] SSE streaming endpoints emit events
- [ ] Unit tests cover auth, RBAC, and endpoint logic
- [ ] Integration tests cover full request/response cycles

## Startup

```bash
cd /home/alysson/Github/mah-mobile/api
npm run dev  # starts express with ts-node-dev
npm run test # runs jest tests
```