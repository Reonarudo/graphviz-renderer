import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, type RenderResult } from '../dist/index.js';

// Golden SVG tests (Releasing; ADR 0009): every graphviz fence the site's showcase and the
// extension's demos render, compared byte-for-byte with the files in test/golden/. A changed
// golden since the last release makes the next release at least minor. Re-record only on purpose:
// UPDATE_GOLDEN=1 npm test, and commit the re-recording with the change.

const golden = fileURLToPath(new URL('./golden/', import.meta.url));
const update = process.env.UPDATE_GOLDEN === '1';

interface Fence { name: string; origin: 'site' | 'extension'; lang: string; from: string; }
const fences: Fence[] = JSON.parse(readFileSync(join(golden, 'fences.json'), 'utf8'));

const runtime = await createRuntime();
after(() => runtime.dispose());

/** Compare a result with its golden: the SVG when it renders, else the whole result as JSON. */
function check(path: string, result: RenderResult): void {
  const svg = `${path}.svg`;
  const json = `${path}.json`;
  const [file, actual] = result.status === 'success'
    ? [svg, result.output]
    : [json, JSON.stringify(result, null, 2) + '\n'];
  if (update) {
    rmSync(svg, { force: true });
    rmSync(json, { force: true });
    writeFileSync(file, actual);
    return;
  }
  assert.ok(existsSync(file), `no golden ${file}: the fence now ends in ${result.status}`);
  assert.equal(actual, readFileSync(file, 'utf8'));
}

for (const fence of fences) {
  test(`${fence.origin}/${fence.name} (${fence.from}) matches its golden`, async () => {
    const path = join(golden, fence.origin, fence.name);
    const source = readFileSync(`${path}.${fence.lang}`, 'utf8');
  check(path, runtime.render({ source }));
  });
}
