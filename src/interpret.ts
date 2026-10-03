import type { RenderResult } from './runtime.js';
import { OutputTooLarge, sanitizeSvg } from './sanitizer.js';

/** What viz returns for one `svg_inline` render. */
export interface Layout {
  status: 'success' | 'failure';
  output?: string;
  errors: { level?: 'error' | 'warning'; message: string }[];
}

/** `syntax error in line 2 near ';'` — Graphviz puts the line inside its sentence. */
const located = / in line (\d+)\b/;
/**
 * `... <HTML><B>x</I></HTML> ...` — Graphviz's excerpt of the source around an error, wrapped in
 * markup of its own. Like gnuplot's echo, it is dropped: the line is reported instead.
 */
const excerpt = /^\.\.\. [\s\S]* \.\.\.$/;

/**
 * `in label of node a` — follows an error in an HTML-like label, whose line Graphviz counts from
 * the start of the label, not of the fence.
 */
const inLabel = /^in label of /;

/**
 * Turn one viz render into a render result. Errors become the failure's plain-text message with
 * their line lifted out; on a success, warnings and recovered errors (a malformed HTML label is
 * still drawn) become notes. A line that is not a fence line — outside the body, or counted
 * inside an HTML label — is left in Graphviz's words rather than reported as a location.
 */
export function interpret(layout: Layout, source: string, prefix: string, outputBytes: number): RenderResult {
  const lineCount = source.split('\n').length;
  const kept = layout.errors.map(({ level, message }) => ({ level, message: message.trim() }))
    .filter(({ message }) => !excerpt.test(message));
  const messages = kept.map(({ level, message }, index) => {
    const match = located.exec(message);
    const line = match ? Number(match[1]) : 0;
    if (line < 1 || line > lineCount || inLabel.test(kept[index + 1]?.message ?? '')) return { level, text: message };
    return { level, text: message.replace(located, ''), line };
  });

  if (layout.status !== 'success' || layout.output === undefined) {
    const errors = messages.filter(({ level }) => level !== 'warning');
    if (errors.length === 0) return { status: 'failure', message: 'the fence contains no graph' };
    const message = errors.map(({ text }) => text).join('\n');
    const line = errors.find((error) => error.line !== undefined)?.line;
    return line === undefined ? { status: 'failure', message } : { status: 'failure', message, line };
  }

  let output: string;
  try {
    output = sanitizeSvg(layout.output, { prefix, outputBytes });
  } catch (error) {
    if (error instanceof OutputTooLarge) {
      return { status: 'failure', message: `graphviz output exceeds the ${outputBytes}-byte limit` };
    }
    return { status: 'failure', message: (error as Error).message };
  }
  const notes = messages.map(({ text, line }) => {
    const plain = text.replace(/^(?:Warning|Error): /, '');
    return line === undefined ? plain : `line ${line}: ${plain}`;
  });
  return { status: 'success', output, notes };
}
