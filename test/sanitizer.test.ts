import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { OutputTooLarge, sanitizeSvg } from '../src/sanitizer.js';

const require = createRequire(import.meta.url);
let viz: { render(source: string, options: { format: string }): { status: string; output?: string } };
before(async () => { viz = await require('../vendor/viz/viz.cjs').instance(); });

const options = { prefix: 'graphviz-0123abcd-', outputBytes: 4 * 1024 * 1024 };

/** Render DOT exactly as the worker does, so every case runs against real Graphviz output. */
function dot(source: string): string {
  const result = viz.render(source, { format: 'svg_inline' });
  assert.equal(result.status, 'success', source);
  return result.output!;
}

/**
 * Sanitize, treating a refusal (malformed XML after a breakout) as an acceptable outcome — its
 * message ends up in the failure, so it is checked along with any output.
 */
function sanitizedOrRefused(svg: string): string {
  try { return sanitizeSvg(svg, options); } catch (error) { return (error as Error).message; }
}

test('plain Graphviz output becomes an inline-ready SVG with its shapes and labels', () => {
  const svg = sanitizeSvg(dot('digraph { hello -> world }'), options);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" viewBox="0\.00 0\.00 [\d.]+ [\d.]+" class="graphviz">/);
  assert.match(svg, /<ellipse /);
  assert.match(svg, />hello<\/text>/);
  assert.match(svg, /<path /);
  assert.doesNotMatch(svg, /<!--|<\?xml|<!DOCTYPE/);
});

test('markup injected through fontname, FONT FACE or comment never survives', () => {
  for (const source of [
    'digraph { a [fontname="Arial\\" onload=\\"alert(1)\\" x=\\""] }',
    'digraph { a [fontname="x\\"/><script>alert(1)</script><foreignObject><img src=https://evil.example/x></foreignObject><text x=\\""] }',
    'digraph { a [fontname="x\\" style=\\"position:fixed;background:url(https://evil.example/t)"] }',
    'digraph { a [label=<<FONT FACE="x&quot; onload=&quot;alert(1)">hi</FONT>>] }',
    'digraph { a [fontname="x\\"/><a href=\\"javascript:alert(1)\\"><text>click</text></a><text x=\\""] }',
    'digraph { comment="--><script>alert(1)</script><!--" a [comment="--><foreignObject/><!--"] }'
  ]) {
    const output = sanitizedOrRefused(dot(source));
    assert.doesNotMatch(output, /<script|onload|<foreignObject|<img|style=|javascript:|https:/, source);
  }
});

test('a node with an unsafe link or only a tooltip keeps its shapes but loses the link', () => {
  for (const attrs of [
    'URL="javascript:alert(1)"',
    'href="&#106;avascript:alert(1)"',
    'href="data:text/html,<script>alert(1)</script>"',
    'URL="vscode://some.extension/run"',
    'URL="relative/page.html"',
    'URL="//evil.example/x"',
    'tooltip="just a tooltip"'
  ]) {
    const svg = sanitizeSvg(dot(`digraph { node1 [${attrs}] }`), options);
    assert.match(svg, /<ellipse /, attrs);
    assert.match(svg, />node1<\/text>/, attrs);
    assert.doesNotMatch(svg, /<a[\s>]|javascript|data:|vscode:|relative|evil/, attrs);
  }
});

test('http, https and mailto links survive with their tooltip; target does not', () => {
  for (const [url, expected] of [
    ['https://graphviz.org/docs/', 'https://graphviz.org/docs/'],
    ['http://example.com/a?b=1&c=2', 'http://example.com/a?b=1&amp;c=2'],
    ['mailto:someone@example.com', 'mailto:someone@example.com']
  ] as const) {
    const svg = sanitizeSvg(dot(`digraph { a [URL="${url}" tooltip="Open the docs" target="_blank"] }`), options);
    assert.match(svg, new RegExp(`<a xlink:href="${expected.replace(/[?.]/g, '\\$&')}" xlink:title="Open the docs">`), url);
    assert.match(svg, /<ellipse /, url);
    assert.doesNotMatch(svg, /target=/, url);
  }
});

test('a tooltip that names a URL or a script scheme is dropped from a kept link', () => {
  for (const tooltip of ['see https://evil.example', 'javascript:alert(1)', 'data:text/html,x']) {
    const svg = sanitizeSvg(dot(`digraph { a [URL="https://graphviz.org/" tooltip="${tooltip}"] }`), options);
    assert.match(svg, /<a xlink:href="https:\/\/graphviz\.org\/">/, tooltip);
    assert.doesNotMatch(svg, /xlink:title/, tooltip);
  }
});

test('links on edges, clusters and the graph follow the same rule', () => {
  const svg = sanitizeSvg(dot('digraph { URL="https://g.example/" subgraph cluster_x { URL="javascript:x" a } ' +
    'a -> b [URL="mailto:x@y.example" label="e"] }'), options);
  const links = [...svg.matchAll(/<a xlink:href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links.sort(), ['https://g.example/', 'mailto:x@y.example', 'mailto:x@y.example'].sort());
  assert.doesNotMatch(svg, /javascript/);
});

test('images are never emitted, whether by attribute or HTML label', () => {
  for (const source of ['digraph { a [image="/etc/passwd"] }', 'digraph { a [image="https://evil.example/x.png"] }',
    'digraph { a [label=<<TABLE><TR><TD><IMG SRC="https://evil.example/x.png"/></TD></TR></TABLE>>] }']) {
    const result = viz.render(source, { format: 'svg_inline' });
    if (result.status !== 'success') continue;
    assert.doesNotMatch(sanitizeSvg(result.output!, options), /<image|evil|passwd/, source);
  }
});

test('gradient stops keep their colours and Graphviz classes survive', () => {
  const svg = sanitizeSvg(dot('digraph { a [style=filled fillcolor="red:blue" class="highlight"] }'), options);
  assert.match(svg, /<stop offset="0" style="stop-color:red;stop-opacity:1\.;"\/>/);
  assert.match(svg, /<stop offset="1" style="stop-color:blue;stop-opacity:1\.;"\/>/);
  assert.match(svg, /fill="url\(#graphviz-0123abcd-[^)]+\)"/);
  assert.match(svg, /class="node highlight"/);
  assert.match(svg, /class="graph"/);
});

test('style is dropped everywhere except on gradient stops', () => {
  const svg = sanitizedOrRefused(dot('digraph { a [fontname="x\\" style=\\"stop-color:red;background:url(https://evil.example/t)"] }'));
  assert.doesNotMatch(svg, /style=|evil/);
});

test('every id and local reference is namespaced, and every reference still resolves', () => {
  const svg = sanitizeSvg(dot('digraph { bgcolor="yellow:green" a [style=filled fillcolor="red:blue" id="mine"] b -> a }'), options);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
  const refs = [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]!);
  assert.ok(ids.includes('graphviz-0123abcd-mine'));
  for (const id of ids) assert.match(id, /^graphviz-0123abcd-/);
  assert.ok(refs.length >= 2);
  for (const ref of refs) assert.ok(ids.includes(ref), ref);
});

test('labels keep runs of spaces, which Graphviz writes as non-breaking spaces', () => {
  const svg = sanitizeSvg(dot('digraph { a [label="a    b"] }'), options);
  assert.match(svg, />a \u00a0\u00a0\u00a0b<\/text>/);
});

test('rejects malformed, entity-bearing and non-SVG documents with a fixed message', () => {
  for (const source of ['<html/>', '<!DOCTYPE svg [<!ENTITY a "bad">]><svg viewBox="0 0 1 1"/>', '<svg viewBox="0 0 1 1"><path>',
    '<svg/>', '<math xmlns="http://www.w3.org/1998/Math/MathML"/>']) {
    assert.throws(() => sanitizeSvg(source, options), { message: 'graphviz produced SVG that could not be sanitized' }, source);
  }
});

test('raw output over the limit is refused before it is parsed', () => {
  const svg = dot('digraph { a -> b }');
  assert.throws(() => sanitizeSvg(svg, { ...options, outputBytes: svg.length - 1 }), OutputTooLarge);
  assert.match(sanitizeSvg(svg, { ...options, outputBytes: svg.length }), /^<svg /);
});

test('sanitized output over the limit is refused, even when namespacing is what grew it', () => {
  const svg = `<svg viewBox="0 0 1 1">${'<g id="a"/>'.repeat(100)}</svg>`;
  const sanitized = sanitizeSvg(svg, options);
  assert.ok(Buffer.byteLength(sanitized) > svg.length);
  assert.throws(() => sanitizeSvg(svg, { ...options, outputBytes: Buffer.byteLength(sanitized) - 1 }), OutputTooLarge);
  assert.equal(sanitizeSvg(svg, { ...options, outputBytes: Buffer.byteLength(sanitized) }), sanitized);
});
