import type { z } from 'zod';

/**
 * Dependency-free Server-Sent Events client on Node's fetch streaming (AGENTS.md §7.6 stream recipe).
 *
 * Brain Town sends NAMED events: `id: <seq>`, `event: <type>`, `data: <json>`, plus `retry:` and
 * `: heartbeat` comments. The server subscribes to its hub before it writes the first `retry:` line, so
 * `connect()` resolves only after that line arrived: anything triggered afterwards is guaranteed to be pushed.
 *
 * Every wait is bounded. Always close the connection (the `sse` fixture does it in teardown).
 */
export interface ServerSentEvent {
  /** `id:` field (Brain Town: the event seq), empty when absent. */
  readonly id: string;
  /** `event:` field; "message" when absent. */
  readonly event: string;
  readonly data: string;
  /** `data` parsed as JSON, or undefined when it is not JSON. */
  readonly json: unknown;
}

export interface SseConnectOptions {
  headers?: Record<string, string>;
  /** Sent as `Last-Event-ID` to ask the server to replay what came after it. */
  lastEventId?: string;
  /** Bound for the HTTP response + first `retry:` line. */
  timeoutMs?: number;
}

export class SseHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`SSE ${url} answered HTTP ${status}`);
  }
}

type Waiter = { predicate: (e: ServerSentEvent) => boolean; resolve: (e: ServerSentEvent) => void };

export class SseConnection {
  /** Every event received so far, in arrival order. */
  readonly events: ServerSentEvent[] = [];
  private readonly waiters = new Set<Waiter>();
  private closed = false;
  private failure: unknown;

  private constructor(
    readonly url: string,
    private readonly controller: AbortController,
  ) {}

  static async connect(url: string, options: SseConnectOptions = {}): Promise<SseConnection> {
    const controller = new AbortController();
    const conn = new SseConnection(url, controller);
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timer = setTimeout(
      () => controller.abort(new Error(`SSE ${url}: no stream within ${timeoutMs} ms`)),
      timeoutMs,
    );
    try {
      const headers: Record<string, string> = { accept: 'text/event-stream', ...options.headers };
      if (options.lastEventId !== undefined) headers['last-event-id'] = options.lastEventId;
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status !== 200 || !response.body) {
        controller.abort();
        throw new SseHttpError(response.status, url);
      }
      const body = response.body;
      await new Promise<void>((resolve, reject) => {
        void conn.pump(body, { resolve, reject });
      });
      return conn;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolves with the first event (already received or future) that matches, or rejects after `timeoutMs`. */
  waitFor(predicate: (e: ServerSentEvent) => boolean, timeoutMs = 10_000): Promise<ServerSentEvent> {
    const hit = this.events.find(predicate);
    if (hit) return Promise.resolve(hit);
    if (this.closed)
      return Promise.reject(
        new Error(`SSE ${this.url} is closed${this.failure instanceof Error ? `: ${this.failure.message}` : ''}`),
      );
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (e) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`SSE ${this.url}: no matching event within ${timeoutMs} ms (${this.events.length} received)`));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  /** Convenience: wait for an event whose JSON `data` passes the zod schema and the predicate. */
  async waitForJson<S extends z.ZodType>(
    schema: S,
    predicate: (data: z.output<S>) => boolean,
    timeoutMs = 10_000,
  ): Promise<z.output<S>> {
    const event = await this.waitFor((e) => {
      const parsed = schema.safeParse(e.json);
      return parsed.success && predicate(parsed.data);
    }, timeoutMs);
    return schema.parse(event.json);
  }

  /** Parsed JSON payloads of every event received so far that pass the schema. */
  jsonEvents<S extends z.ZodType>(schema: S): z.output<S>[] {
    return this.events.flatMap((e) => {
      const parsed = schema.safeParse(e.json);
      return parsed.success ? [parsed.data] : [];
    });
  }

  close(): void {
    this.closed = true;
    this.controller.abort();
  }

  private async pump(
    body: ReadableStream<Uint8Array>,
    ready: { resolve: () => void; reject: (reason: unknown) => void },
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    let isReady = false;
    let id = '';
    let event = '';
    let data: string[] = [];
    const markReady = () => {
      if (!isReady) {
        isReady = true;
        ready.resolve();
      }
    };
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.search(/\r\n|\n|\r/)) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + (buffer.startsWith('\r\n', nl) ? 2 : 1));
          if (line === '') {
            if (data.length > 0) this.dispatch({ id, event: event || 'message', data: data.join('\n') });
            event = '';
            data = [];
            continue;
          }
          if (line.startsWith(':')) continue; // comment (heartbeat)
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'data') data.push(value);
          else if (field === 'event') event = value;
          else if (field === 'id') id = value;
          else if (field === 'retry') markReady();
        }
      }
    } catch (error) {
      this.failure = error;
    } finally {
      this.closed = true;
      if (!isReady) ready.reject(this.failure ?? new Error(`SSE ${this.url} ended before the stream started`));
    }
  }

  private dispatch(raw: { id: string; event: string; data: string }): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.data);
    } catch {
      json = undefined;
    }
    const e: ServerSentEvent = { ...raw, json };
    this.events.push(e);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(e)) waiter.resolve(e);
    }
  }
}
