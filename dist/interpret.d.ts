import type { RenderResult } from './runtime.js';
/** What viz returns for one `svg_inline` render. */
export interface Layout {
    status: 'success' | 'failure';
    output?: string;
    errors: {
        level?: 'error' | 'warning';
        message: string;
    }[];
}
/**
 * Turn one viz render into a render result. Errors become the failure's plain-text message with
 * their line lifted out; on a success, warnings and recovered errors (a malformed HTML label is
 * still drawn) become notes. A line that is not a fence line — outside the body, or counted
 * inside an HTML label — is left in Graphviz's words rather than reported as a location.
 */
export declare function interpret(layout: Layout, source: string, prefix: string, outputBytes: number): RenderResult;
