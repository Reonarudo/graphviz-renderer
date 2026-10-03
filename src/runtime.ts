import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { ENGINE, FAILED, HEADER, LENGTH, READY, STARTED, STARTING, type Reply, type Request } from './protocol.js';

export interface RuntimeOptions {
  /** Milliseconds per render; default 3000. */
  timeout?: number;
  /** Milliseconds per engine start; default 10000. */
  startupTimeout?: number;
  limits?: {
    /** Whole fence body, in string length; default 64000. */
    sourceChars?: number;
    /** Success output, in UTF-8 bytes; default 4 MiB. */
    outputBytes?: number;
  };
}

export interface RenderInput {
  source: string;
}

export type RenderResult =
  | { status: 'success'; output: string; notes: string[] }
  | { status: 'failure'; message: string; line?: number; column?: number }
  | { status: 'timeout'; budget: number }
  | { status: 'unavailable'; reason: string };

export interface Runtime {
  render(input: RenderInput): RenderResult;
  dispose(): Promise<void>;
}

/** A runtime-wide option: absent for its default, else a finite positive number. */
function option(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }
  return value;
}

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
  if (options.limits !== undefined && (typeof options.limits !== 'object' || options.limits === null)) {
    throw new TypeError('limits must be an object');
  }
  const timeout = option(options.timeout, 'timeout', 3000);
  const startupTimeout = option(options.startupTimeout, 'startupTimeout', 10000);
  const sourceChars = option(options.limits?.sourceChars, 'limits.sourceChars', 64000);
  const outputBytes = option(options.limits?.outputBytes, 'limits.outputBytes', 4 * 1024 * 1024);
  // JSON at most doubles sanitized SVG (quotes and newlines escape to two bytes); the slack holds
  // the envelope and a failure message.
  const capacity = 2 * outputBytes + 65536;

  let worker: Worker | undefined;
  let state: Int32Array<SharedArrayBuffer>;
  let bytes: Uint8Array<SharedArrayBuffer>;
  let disposed = false;

  const spawn = (): Worker => {
    // Each worker gets its own buffer: a terminated worker still finishing a layout must not be
    // able to write its late answer where its replacement's answer is expected.
    const buffer = new SharedArrayBuffer(HEADER + capacity);
    state = new Int32Array(buffer, 0, HEADER / 4);
    bytes = new Uint8Array(buffer, HEADER);
    worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { buffer },
      env: {},
      stdout: true,
      stderr: true,
      // Twice the extension's cap: the worker now also sanitizes, and parsing an output at the
      // 4 MiB limit made of small shapes needs about 200 MB.
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    // Emscripten reports an abort on stderr; the render learns of it through its reply.
    worker.stdout.resume();
    worker.stderr.resume();
    // A crash surfaces to the waiting render as a timeout; this only keeps it from being fatal.
    worker.on('error', () => {});
    worker.unref();
    return worker;
  };
  const stop = (): void => {
    void worker?.terminate();
    worker = undefined;
  };
  const payload = (): string =>
    new TextDecoder().decode(bytes.slice(0, Atomics.load(state, LENGTH)));

  // Start the first engine now, so the first fence does not wait for it. Not fatal if it fails:
  // the next render starts a fresh one.
  spawn();
  await new Promise<void>((resolve) => {
    const started = worker!;
    const timer = setTimeout(done, startupTimeout);
    function done(): void {
      clearTimeout(timer);
      started.off('message', done);
      resolve();
    }
    started.on('message', done);
  });

  return {
    render(input) {
      if (disposed) throw new Error('render() called after dispose()');
      if (typeof input !== 'object' || input === null || typeof input.source !== 'string') {
        throw new TypeError('render() takes { source: string }');
      }
      const { source } = input;
      if (source.length > sourceChars) {
        return { status: 'failure', message: `graphviz source exceeds the ${sourceChars}-character limit` };
      }

      if (!worker) spawn();
      if (Atomics.load(state, ENGINE) === STARTING) Atomics.wait(state, ENGINE, STARTING, startupTimeout);
      const engine = Atomics.load(state, ENGINE);
      if (engine !== STARTED) {
        const why = engine === FAILED ? payload() : `graphviz did not start within ${startupTimeout} ms`;
        stop();
        return { status: 'unavailable', reason: why };
      }

      Atomics.store(state, READY, 0);
      const prefix = `graphviz-${createHash('sha256').update(source).digest('hex').slice(0, 8)}-`;
      worker!.postMessage({ source, prefix, outputBytes } satisfies Request);
      if (Atomics.wait(state, READY, 0, timeout) === 'timed-out') {
        stop();
        return { status: 'timeout', budget: timeout };
      }
      const { discard, ...result } = JSON.parse(payload()) as Reply;
      if (discard) stop();
      return result;
    },
    async dispose() {
      disposed = true;
      const last = worker;
      worker = undefined;
      await last?.terminate();
    }
  };
}
