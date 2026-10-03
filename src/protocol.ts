import type { RenderResult } from './runtime.js';

/** The host and its worker share one buffer: an Int32 header, then the reply as UTF-8 JSON. */

/** What the worker is asked to do for one fence. */
export interface Request {
  source: string;
  prefix: string;
  outputBytes: number;
}

/** What the worker answers: a render result, and whether its engine must not be used again. */
export type Reply = RenderResult & { discard?: true };

/** Int32 slots at the head of the shared buffer. */
export const READY = 0;
export const LENGTH = 1;
export const ENGINE = 2;
/** Values of the ENGINE slot. */
export const STARTING = 0;
export const STARTED = 1;
export const FAILED = 2;
export const HEADER = 12;
