import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../dist/index.js';

const runtime = await createRuntime();
after(() => runtime.dispose());

test('a graph renders to inline-ready SVG with the renderer name as its only class', () => {
  const result = runtime.render({ source: 'digraph { a -> b }' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.match(result.output, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" viewBox="0\.00 0\.00 62\.00 116\.00" class="graphviz">/);
  assert.match(result.output, /<\/svg>$/);
  assert.doesNotMatch(result.output, /<\?xml|<!--|<!DOCTYPE/);
  assert.doesNotMatch(result.output.slice(0, result.output.indexOf('>')), /\swidth=|\sheight=/);
  assert.deepEqual(result.notes, []);
});

test('every layout engine renders', () => {
  for (const layout of ['dot', 'neato', 'fdp', 'sfdp', 'circo', 'twopi', 'osage', 'patchwork']) {
    const result = runtime.render({ source: `graph { layout=${layout}; a -- b -- c -- a }` });
    assert.equal(result.status, 'success', layout);
  }
});

test('a syntax error is plain text with its line lifted out of the message', () => {
  assert.deepEqual(runtime.render({ source: 'digraph {\n  a -> ;\n}' }), {
    status: 'failure', message: "syntax error near ';'", line: 2
  });
  assert.deepEqual(runtime.render({ source: 'digraph {\n  a [label="x' }), {
    status: 'failure', message: 'syntax error scanning a quoted string (missing endquote? longer than 16384?)\nString starting:"x', line: 2
  });
});

test('an error without a line carries none', () => {
  assert.deepEqual(runtime.render({ source: 'digraph { layout=bogus; a }' }), {
    status: 'failure',
    message: 'Layout type: "bogus" not recognized. Use one of: circo dot fdp neato nop nop1 nop2 osage patchwork sfdp twopi'
  });
});

test('a fence with no graph is a failure', () => {
  for (const source of ['', '  \n', '/* only a comment */']) {
    assert.deepEqual(runtime.render({ source }), { status: 'failure', message: 'the fence contains no graph' }, JSON.stringify(source));
  }
});

test('warnings of a successful render become plain-text notes', () => {
  const result = runtime.render({ source: 'digraph { a [shape=bogus] b [fontname="sans-serif"] }' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(result.notes, [
    'using box for unknown shape bogus',
    "no hard-coded metrics for 'sans-serif'.  Falling back to 'Times' metrics"
  ]);
});

test('a malformed HTML label is drawn anyway; its error becomes a note without the excerpt', () => {
  // Graphviz counts this line inside the label, so it is not reported as a fence line.
  const result = runtime.render({ source: 'digraph {\n  a [label=<<B>x</I>>]\n}' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(result.notes, ['mismatched tag in line 1', 'in label of node a']);
});

test('images are not loaded; the note names only what the author wrote', () => {
  const result = runtime.render({ source: 'digraph { a [image="pic.png"] b [label=<<IMG SRC="pic.png"/>>] }' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.doesNotMatch(result.output, /<image|pic\.png/);
  for (const note of result.notes) assert.doesNotMatch(note, /[<>]|\/Users|\/home|vendor|viz\.cjs/, note);
  assert.ok(result.notes.some((note) => note.includes('pic.png')));
});

/** A deterministic graph dense enough that `dot` layout takes seconds, not milliseconds. */
function denseGraph(nodes: number, edgesPerNode: number): string {
  const edges: string[] = [];
  for (let i = 0; i < nodes; i++) {
    for (let k = 1; k <= edgesPerNode; k++) edges.push(`n${i} -> n${(i * 7 + k * 13) % nodes};`);
  }
  return `digraph { ${edges.join(' ')} }`;
}

test('a runaway graph times out within its budget, and the next render on the runtime succeeds', async () => {
  // Starting a fresh engine takes about as long as this budget: the renders after the timeout
  // succeed only if the replacement's start is not charged to them.
  const quick = await createRuntime({ timeout: 100 });
  try {
    const started = performance.now();
    assert.deepEqual(quick.render({ source: denseGraph(300, 8) }), { status: 'timeout', budget: 100 });
    assert.ok(performance.now() - started < 1000);
    assert.equal(quick.render({ source: 'digraph { a -> b }' }).status, 'success');
    assert.equal(quick.render({ source: 'digraph { b -> c }' }).status, 'success');
  } finally {
    await quick.dispose();
  }
});

test('a slow engine start is bounded by startupTimeout and does not consume the first render\'s budget', async () => {
  const started = performance.now();
  const tight = await createRuntime({ timeout: 1000, startupTimeout: 10000 });
  const startup = performance.now() - started;
  try {
    // The first render waits for nothing: its whole budget is its own.
    const before = performance.now();
    assert.equal(tight.render({ source: 'digraph { a -> b }' }).status, 'success');
    assert.ok(performance.now() - before < startup + 1000);
  } finally {
    await tight.dispose();
  }
});

test('an engine that does not start in time makes that render unavailable, not the runtime', async () => {
  const slow = await createRuntime({ startupTimeout: 1 });
  try {
    assert.deepEqual(slow.render({ source: 'digraph { a }' }), { status: 'unavailable', reason: 'graphviz did not start within 1 ms' });
  } finally {
    await slow.dispose();
  }
});

test('invalid runtime options reject createRuntime', async () => {
  for (const options of [
    { timeout: 0 }, { timeout: -1 }, { timeout: Number.NaN }, { timeout: Infinity }, { startupTimeout: 0 },
    { startupTimeout: -Infinity }, { limits: { sourceChars: 0 } }, { limits: { outputBytes: -5 } },
    { limits: { sourceChars: Infinity } }, { timeout: '100' }, { limits: null }, null
  ]) {
    await assert.rejects(createRuntime(options as never), TypeError, JSON.stringify(options));
  }
});

test('render throws only for programmer errors: malformed input or a disposed runtime', async () => {
  for (const input of [undefined, null, 'digraph { a }', {}, { source: 42 }]) {
    assert.throws(() => runtime.render(input as never), TypeError, JSON.stringify(input));
  }
  const disposable = await createRuntime();
  await disposable.dispose();
  await disposable.dispose();
  assert.throws(() => disposable.render({ source: 'digraph { a }' }), /dispose/);
});

test('a source over the character limit is a failure naming the limit; one at the limit renders', () => {
  const atLimit = 'digraph { a }' + ' '.repeat(64000 - 13);
  assert.equal(runtime.render({ source: atLimit }).status, 'success');
  assert.deepEqual(runtime.render({ source: atLimit + ' ' }), {
    status: 'failure', message: 'graphviz source exceeds the 64000-character limit'
  });
});

test('limits are runtime options', async () => {
  const small = await createRuntime({ limits: { sourceChars: 13, outputBytes: 700 } });
  try {
    assert.equal(small.render({ source: 'digraph { a }' }).status, 'success');
    assert.deepEqual(small.render({ source: 'digraph { ab }' }), {
      status: 'failure', message: 'graphviz source exceeds the 13-character limit'
    });
    assert.deepEqual(small.render({ source: 'graph{a--b}' }), {
      status: 'failure', message: 'graphviz output exceeds the 700-byte limit'
    });
  } finally {
    await small.dispose();
  }
});

test('the default output limit is 4 MiB', () => {
  // Each periphery is one <ellipse>: about 4.5 MB of them from a one-line fence.
  assert.deepEqual(runtime.render({ source: 'graph { node [peripheries=6000]; a; b; c; d; e; f; g; h; i; j }' }), {
    status: 'failure', message: 'graphviz output exceeds the 4194304-byte limit'
  });
});

test('a timed-out or over-limit render leaves the runtime usable', () => {
  assert.equal(runtime.render({ source: 'graph { node [peripheries=6000]; a; b; c; d; e; f; g; h; i; j }' }).status, 'failure');
  assert.equal(runtime.render({ source: 'digraph { a -> b }' }).status, 'success');
});

/** Every value of an attribute, in document order. */
const values = (svg: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1]!);

test('two graphs on one page share no id, and every internal reference still resolves', () => {
  const outputs: string[] = [];
  // Graphviz names nodes, edges and gradients the same way in every graph.
  for (const source of ['digraph { a [style=filled fillcolor="red:blue"] a -> b }', 'digraph { x [style=filled fillcolor="green:white"] x -> y }']) {
    const result = runtime.render({ source });
    assert.equal(result.status, 'success');
    if (result.status === 'success') outputs.push(result.output);
  }
  const [one, two] = outputs.map((svg) => new Set(values(svg, 'id')));
  assert.ok(one!.size > 0);
  for (const id of one!) assert.ok(!two!.has(id), id);
  outputs.forEach((svg, index) => {
    const ids = [one, two][index]!;
    for (const id of ids) assert.match(id, /^graphviz-[0-9a-f]{8}-/);
    const urls = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
    assert.ok(urls.length > 0);
    for (const target of urls) assert.ok(ids.has(target), target);
    assert.doesNotMatch(svg, /<style/);
  });
});

test('the same input yields byte-identical output, also across runtimes', async () => {
  const source = 'digraph { rankdir=LR; a [style=filled fillcolor="red:blue"] a -> b -> c; b -> d }';
  const other = await createRuntime();
  try {
    const first = runtime.render({ source });
    assert.equal(first.status, 'success');
    assert.deepEqual(runtime.render({ source }), first);
    assert.deepEqual(other.render({ source }), first);
  } finally {
    await other.dispose();
  }
});

/** Every attribute value in the SVG's tags, except namespace declarations. Text is left out. */
const attributeValues = (svg: string): string[] => [...svg.matchAll(/<[^>]*>/g)]
  .flatMap((tag) => [...tag[0].matchAll(/\s(?!xmlns[=:])([\w:-]+)="([^"]*)"/g)]
    // A followable link is the one value allowed to name a network URL.
    .filter((m) => !(m[1] === 'xlink:href' && tag[0].startsWith('<a ')))
    .map((m) => m[2]!));

test('markup, script and links in labels and attributes stay inert', () => {
  const source = [
    'digraph {',
    '  label="<script>alert(1)</script>"',
    '  a [label="<foreignObject><img src=x onerror=alert(1)></foreignObject>"]',
    '  b [fontname="x\\" onload=\\"alert(1)"]',
    '  c [URL="javascript:alert(1)" tooltip="javascript:alert(2)"]',
    '  d [href="data:text/html,1" label="https://evil.example/t"]',
    '  e [image="https://evil.example/x.png"]',
    '  f [URL="https://graphviz.org/"]',
    '  "<svg onload=alert(1)>" -> a',
    '}'
  ].join('\n');
  const result = runtime.render({ source });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  const tags = new Set([...result.output.matchAll(/<\/?([\w:-]+)/g)].map((m) => m[1]!));
  for (const tag of ['script', 'foreignObject', 'image', 'img']) assert.ok(!tags.has(tag), tag);
  assert.doesNotMatch(result.output, /<[^>]*\son\w+=/);
  for (const value of attributeValues(result.output)) assert.doesNotMatch(value, /javascript:|data:|https?:|url\((?!#)/, value);
  assert.deepEqual([...result.output.matchAll(/<a xlink:href="([^"]+)"/g)].map((m) => m[1]), ['https://graphviz.org/']);
  assert.match(result.output, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('messages and notes from malformed fences are plain text', () => {
  for (const source of ['digraph { <script> }', 'digraph { a [label=<<b>x</i>>] }', 'digraph { a -> <svg> }',
    'digraph { a [label=<<TABLE><TR><TD>x</TD></TABLE>>] }', 'digraph { a [label=<<IMG SRC="/etc/x"/>>] }']) {
    const result = runtime.render({ source });
    const texts = result.status === 'failure' ? [result.message] : result.status === 'success' ? result.notes : [];
    assert.ok(result.status === 'failure' || result.status === 'success', source);
    for (const text of texts) assert.doesNotMatch(text, /<\/?[A-Za-z]|&\w+;|\/Users|\/home|vendor|viz\.cjs/, `${source}: ${text}`);
  }
});
