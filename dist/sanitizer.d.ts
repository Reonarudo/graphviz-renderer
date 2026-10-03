/** Thrown when the sanitized SVG would exceed the output limit. */
export declare class OutputTooLarge extends Error {
}
export interface SanitizeOptions {
    /** Prepended to every id and every reference to one: `graphviz-<8 hex>-`. */
    prefix: string;
    /** UTF-8 bytes the result may take. */
    outputBytes: number;
}
/**
 * Parse Graphviz's `svg_inline` output as XML, keep only the allowlisted elements and attributes
 * and followable `http:`, `https:` and `mailto:` links, and namespace every id and local
 * reference. The root keeps its `viewBox` and the class `graphviz`, nothing that sizes it.
 * Throws, with a fixed plain message, on anything that is not a well-formed SVG document, and
 * `OutputTooLarge` past the limit.
 */
export declare function sanitizeSvg(source: string, { prefix, outputBytes }: SanitizeOptions): string;
