import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { ENGINE, FAILED, HEADER, LENGTH, READY, STARTED } from './protocol.js';
import { interpret } from './interpret.js';
const { buffer } = workerData;
const state = new Int32Array(buffer, 0, HEADER / 4);
const bytes = new Uint8Array(buffer, HEADER);
function write(text) {
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > bytes.length)
        throw new RangeError('reply exceeds the shared buffer');
    bytes.set(encoded);
    Atomics.store(state, LENGTH, encoded.length);
    return encoded.length;
}
function reply(result) {
    try {
        write(JSON.stringify(result));
    }
    catch {
        write(JSON.stringify({ status: 'failure', message: 'graphviz output is too large to return' }));
    }
    Atomics.store(state, READY, 1);
    Atomics.notify(state, READY);
}
const require = createRequire(import.meta.url);
/**
 * Load viz and catch hold of its wasm memory, which it does not export. Graphviz keeps state
 * across renders — gradient ids count up from one render to the next — so every render starts
 * from the memory the engine had when it was ready; without that, output would not be
 * deterministic. Loaded inside the promise, so a missing or broken engine file, or one whose
 * memory cannot be found, is a failed start, not a crash.
 */
async function load() {
    let memory;
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = (async (...args) => {
        const result = await instantiate(...args);
        const exports = ('instance' in result ? result.instance : result).exports;
        for (const value of Object.values(exports))
            if (value instanceof WebAssembly.Memory)
                memory = value;
        return result;
    });
    try {
        const viz = await require('../vendor/viz/viz.cjs').instance();
        if (!memory)
            throw new Error('viz memory not found');
        return { viz, memory };
    }
    finally {
        WebAssembly.instantiate = instantiate;
    }
}
load().then(({ viz, memory }) => {
    const snapshot = new Uint8Array(memory.buffer).slice();
    parentPort.on('message', ({ source, prefix, outputBytes }) => {
        let layout;
        try {
            // `svg_inline` omits the xml-stylesheet processing instruction, and no `images` option is
            // passed, so Graphviz finds no image files and emits no <image>.
            layout = viz.render(source, { format: 'svg_inline' });
        }
        catch {
            // viz turns Graphviz's own exit into a failure and rethrows only an abort, such as running
            // out of memory, which leaves the instance unusable; the host discards this worker.
            reply({ status: 'failure', message: 'graphviz stopped unexpectedly', discard: true });
            return;
        }
        new Uint8Array(memory.buffer).set(snapshot);
        reply(interpret(layout, source, prefix, outputBytes));
    });
    Atomics.store(state, ENGINE, STARTED);
    Atomics.notify(state, ENGINE);
    parentPort.postMessage('started');
}, () => {
    // The error would name vendor paths on this machine; the reason stays plain and path-free.
    write('graphviz could not start');
    Atomics.store(state, ENGINE, FAILED);
    Atomics.notify(state, ENGINE);
    parentPort.postMessage('failed');
});
