import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
// The allowlist is the extension's, unchanged (ADR 0004): passive SVG geometry, text, gradients,
// Graphviz's classes and local references only, plus links a reader can follow.
const svgNamespace = 'http://www.w3.org/2000/svg';
const xlinkNamespace = 'http://www.w3.org/1999/xlink';
const elements = new Set(('svg g defs path rect circle ellipse line polyline polygon text tspan title desc use clipPath ' +
    'linearGradient radialGradient stop').split(' '));
const attributes = new Set(('id class x y x1 y1 x2 y2 dx dy cx cy r rx ry width height viewBox preserveAspectRatio d ' +
    'points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin ' +
    'stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style text-anchor ' +
    'text-decoration dominant-baseline baseline-shift clip-path gradientUnits gradientTransform offset stop-color ' +
    'stop-opacity xmlns xmlns:xlink href xlink:href').split(' '));
const localReference = /^#[A-Za-z_][\w:.-]*$/;
const localUrl = /^url\(#[A-Za-z_][\w:.-]*\)$/;
/** Values that could reach outside the diagram, whatever attribute carries them. */
const reaching = /\\|javascript:|data:|https?:|\/\//i;
/** Graphviz writes gradient stops as `style="stop-color:red;stop-opacity:1.;"` — nothing else. */
const gradientStop = /^(?:\s*stop-(?:color|opacity)\s*:\s*[#\w.%]+\s*;)*\s*$/;
/**
 * A link a reader can follow, not a fetch. The value is already entity-decoded here, so
 * `&#106;avascript:` is seen as `javascript:` and refused.
 */
const followable = /^(?:https?:\/\/|mailto:)[^\s\\"<>]+$/i;
const refused = 'graphviz produced SVG that could not be sanitized';
/** Thrown when the sanitized SVG would exceed the output limit. */
export class OutputTooLarge extends Error {
}
/**
 * Parse Graphviz's `svg_inline` output as XML, keep only the allowlisted elements and attributes
 * and followable `http:`, `https:` and `mailto:` links, and namespace every id and local
 * reference. The root keeps its `viewBox` and the class `graphviz`, nothing that sizes it.
 * Throws, with a fixed plain message, on anything that is not a well-formed SVG document, and
 * `OutputTooLarge` past the limit.
 */
export function sanitizeSvg(source, { prefix, outputBytes }) {
    // Graphviz's raw output is held to the limit too, as the extension did: parsing several
    // megabytes takes seconds, and a layout that large would otherwise spend the render budget
    // in the parser and time out instead of failing on the limit.
    if (source.length > outputBytes)
        throw new OutputTooLarge();
    if (/<!DOCTYPE|<!ENTITY/i.test(source))
        throw new Error(refused);
    // `svg_inline` omits the namespace declarations a standalone SVG carries; without them the
    // root would not parse as an SVG element at all.
    const declared = /<svg\b[^>]*\sxmlns=/.test(source)
        ? source
        : source.replace(/<svg\b/, `<svg xmlns="${svgNamespace}" xmlns:xlink="${xlinkNamespace}"`);
    let root;
    try {
        root = new DOMParser({ onError: () => { throw new Error(); } }).parseFromString(declared, 'image/svg+xml').documentElement;
    }
    catch {
        // The parser's own message quotes the offending markup, which may be author-controlled.
        throw new Error(refused);
    }
    if (!root || root.tagName !== 'svg' || root.namespaceURI !== svgNamespace)
        throw new Error(refused);
    const clean = (el) => {
        for (const attr of Array.from(el.attributes)) {
            const { name, value } = attr;
            if (name === 'style' && el.tagName === 'stop' && gradientStop.test(value))
                continue;
            if (!attributes.has(name) ||
                ((name === 'href' || name === 'xlink:href') && !localReference.test(value)) ||
                (/url\s*\(/i.test(value) && !localUrl.test(value)) ||
                (reaching.test(value) && !name.startsWith('xmlns'))) {
                el.removeAttributeNode(attr);
            }
            else if (name === 'id') {
                el.setAttribute(name, prefix + value);
            }
            else if (name === 'href' || name === 'xlink:href') {
                el.setAttribute(name, '#' + prefix + value.slice(1));
            }
            else if (localUrl.test(value)) {
                el.setAttribute(name, `url(#${prefix}${value.slice(5)}`);
            }
        }
        cleanChildren(el, Array.from(el.childNodes));
    };
    const cleanChildren = (parent, children) => {
        for (const child of children) {
            if (child.nodeType !== 1) {
                if (child.nodeType !== 3)
                    parent.removeChild(child);
                continue;
            }
            const element = child;
            const link = element.namespaceURI === svgNamespace && element.tagName === 'a';
            if (link && followable.test(element.getAttribute('xlink:href') ?? '')) {
                // Keep the link and its tooltip, nothing else. A tooltip is text, but one that names a
                // URL or a script scheme is dropped, so no value but the link itself reaches outside.
                for (const attr of Array.from(element.attributes)) {
                    if (attr.name === 'xlink:href')
                        continue;
                    if (attr.name === 'xlink:title' && !reaching.test(attr.value))
                        continue;
                    element.removeAttributeNode(attr);
                }
                cleanChildren(element, Array.from(element.childNodes));
            }
            else if (link) {
                // Graphviz wraps any object with a URL or tooltip in <a>. Removing it would remove the
                // node, so its content is hoisted into its place and cleaned like any other.
                const content = Array.from(element.childNodes);
                for (const node of content)
                    parent.insertBefore(node, element);
                parent.removeChild(element);
                cleanChildren(parent, content);
            }
            else if (element.namespaceURI !== svgNamespace || !elements.has(element.tagName)) {
                parent.removeChild(element);
            }
            else {
                clean(element);
            }
        }
    };
    clean(root);
    if (!root.hasAttribute('viewBox'))
        throw new Error(refused);
    root.removeAttribute('width');
    root.removeAttribute('height');
    root.setAttribute('class', 'graphviz');
    const output = new XMLSerializer().serializeToString(root);
    if (Buffer.byteLength(output, 'utf8') > outputBytes)
        throw new OutputTooLarge();
    return output;
}
