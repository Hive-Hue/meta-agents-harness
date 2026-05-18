---
name: streaming-dev
description: SSE (Server-Sent Events) infrastructure for MAH Mobile — run streaming, terminal streaming, approval push events, reconnect-safe semantics with Last-Event-ID replay, and event normalization to the shared RunStreamEvent taxonomy.
compatibility: [hermes]
---

# Streaming Dev — MAH Mobile Control Plane

Use this skill when implementing or modifying SSE streaming infrastructure for the MAH Mobile control plane.

## When to Use

- Implementing run lifecycle streaming
- Implementing terminal output streaming
- Implementing approval push notifications
- Adding reconnect-safe semantics to any stream
- Normalizing events to the shared RunStreamEvent taxonomy

## RunStreamEvent Taxonomy

All streams MUST emit events in this taxonomy:

```
session.meta       # session metadata changes
session.state      # session state transitions (active/paused/completed)
run.lifecycle      # run start/progress/complete/fail
run.log            # log lines from run execution
run.activity      # tool activity (calls, results)
run.artifact       # artifact created/updated
approval.pending   # new approval request created
approval.resolved  # approval resolved (approved/denied/expired)
terminal.chunk     # terminal output chunk
file.diff          # file diff output
host.warning       # host-level warning
error              # error event
```

## SSE Configuration

```typescript
// infrastructure/sse-server/config.ts
export const SSE_CONFIG = {
  // Keep-alive ping interval (ms)
  keepAliveInterval: 30000,

  // Max events to buffer for reconnect replay
  maxReplayBuffer: 100,

  // Reconnect grace window (ms)
  reconnectGraceWindow: 30000,

  // Event categories that support reconnect
  reconnectableCategories: [
    'run.lifecycle',
    'run.log',
    'run.activity',
    'approval.pending',
    'approval.resolved',
    'terminal.chunk',
  ],

  // Event categories that are one-shot (no replay)
  oneShotCategories: [
    'session.meta',
    'file.diff',
    'host.warning',
    'error',
  ],
};
```

## Event Envelope

```typescript
// infrastructure/sse-server/types.ts
export interface RunStreamEvent {
  id: string;           // unique event ID (uuid)
  category: string;     // from taxonomy above
  sessionId?: string;
  runId?: string;
  timestamp: string;    // ISO 8601
  sequence: number;      // monotonic sequence for ordering
  data: Record<string, unknown>;
  replayable: boolean;  // true if category is in reconnectableCategories
}

export interface SSEStreamOptions {
  runId?: string;
  sessionId?: string;
  targetId?: string;
  categories?: string[];
  lastEventId?: string;  // for reconnect replay
}
```

## SSE Server Implementation

```typescript
// infrastructure/sse-server/index.ts
import { Router, Request, Response } from 'express';

export function createSSEServer() {
  const router = Router();

  // Subscribe to run events
  router.get('/runs/:runId/stream', createRunStreamHandler());
  router.get('/runs/:runId/terminal/stream', createTerminalStreamHandler());
  router.get('/approvals/stream', createApprovalsStreamHandler());

  return router;
}

function createRunStreamHandler() {
  return async (req: Request, res: Response) => {
    const { runId } = req.params;
    const lastEventId = req.headers['last-event-id'] as string;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // If lastEventId provided, replay missed events
    if (lastEventId) {
      const replayEvents = await replayFromOffset(runId, lastEventId);
      for (const event of replayEvents) {
        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.category}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }

    // Subscribe to live events
    let sequence = parseInt(lastEventId || '0') + 1;
    const unsubscribe = eventEmitter.subscribe(runId, (event: RunStreamEvent) => {
      event.sequence = sequence++;
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.category}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Keep-alive
    const keepAlive = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, SSE_CONFIG.keepAliveInterval);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  };
}
```

## Event Emitter (Pub/Sub)

```typescript
// infrastructure/sse-server/emitter.ts
import { EventEmitter } from 'events';
import { RunStreamEvent } from './types';

class RunEventEmitter extends EventEmitter {
  private subscribers: Map<string, Set<(event: RunStreamEvent) => void>> = new Map();

  subscribe(runId: string, handler: (event: RunStreamEvent) => void) {
    const handlers = this.subscribers.get(runId) || new Set();
    handlers.add(handler);
    this.subscribers.set(runId, handlers);

    return () => {
      const h = this.subscribers.get(runId);
      if (h) {
        h.delete(handler);
        if (h.size === 0) this.subscribers.delete(runId);
      }
    };
  }

  emit(runId: string, event: RunStreamEvent) {
    const handlers = this.subscribers.get(runId);
    if (handlers) {
      handlers.forEach((h) => h(event));
    }
    // Also persist to replay buffer
    this.persistToReplayBuffer(runId, event);
  }
}

export const runEventEmitter = new RunEventEmitter();
```

## Replay Logic

```typescript
// infrastructure/sse-server/replay.ts
export async function replayFromOffset(
  runId: string,
  lastEventId: string,
  maxEvents = 100
): Promise<RunStreamEvent[]> {
  // Query replay buffer for events after lastEventId
  const events = await replayBuffer.getEventsAfter(runId, lastEventId, maxEvents);
  return events.filter((e) => SSE_CONFIG.reconnectableCategories.includes(e.category));
}
```

## Hermes Gateway Event Normalization

```typescript
// infrastructure/hermes-gateway-adapter/normalizer.ts
import { RunStreamEvent } from '../sse-server/types';

export function normalizeHermesEvent(hermesEvent: unknown): RunStreamEvent {
  // Map Hermes event format to MAH Mobile RunStreamEvent taxonomy
  // ...
}
```

## Approval Push Events

```typescript
// infrastructure/sse-server/approval-stream.ts
export function broadcastApprovalEvent(event: RunStreamEvent) {
  // Broadcast to all subscribed mobile clients
  runEventEmitter.emit('approvals', event);
}
```

## Testing SSE

```typescript
// tests/unit/streaming/sse.test.ts
describe('SSE Streaming', () => {
  it('emits events in correct taxonomy format', async () => {
    const event: RunStreamEvent = {
      id: 'test-id',
      category: 'run.lifecycle',
      runId: 'run-123',
      timestamp: new Date().toISOString(),
      sequence: 1,
      data: { status: 'running' },
      replayable: true,
    };
    runEventEmitter.emit('run-123', event);
    // verify subscriber received event
  });

  it('replays events after lastEventId', async () => {
    const lastEventId = '10';
    const replayed = await replayFromOffset('run-123', lastEventId);
    expect(replayed.every(e => e.sequence > 10)).toBe(true);
  });

  it('only replays reconnectable event types', async () => {
    const replayed = await replayFromOffset('run-123', '0');
    const oneShotEvents = replayed.filter(
      e => SSE_CONFIG.oneShotCategories.includes(e.category)
    );
    expect(oneShotEvents).toHaveLength(0);
  });
});
```

## Startup

```bash
cd /home/alysson/Github/mah-mobile
npx ts-node infrastructure/sse-server/index.ts
```

## Verification

- [ ] All 12 RunStreamEvent categories emitted correctly
- [ ] Reconnect with Last-Event-ID replays only reconnectable events
- [ ] Keep-alive pings sent at configured interval
- [ ] Event sequence numbers monotonic
- [ ] Hermes Gateway events normalized to RunStreamEvent taxonomy
- [ ] Unit tests cover emitter, replay, and normalization