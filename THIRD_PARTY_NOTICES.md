# Third-party notices and engine provenance

The library's own TypeScript, tests and scripts are MIT licensed (see `LICENSE`). This does
not relicense the vendored engine or its dependencies.

## Graphviz 16.0.0

`vendor/viz/viz.cjs` contains Graphviz 16.0.0 compiled to WebAssembly.

Graphviz is distributed under the **Eclipse Public License 2.0**; the full text is in
`licenses/GRAPHVIZ-EPL-2.0`. Copyright is held by AT&T and the Graphviz contributors — see
<https://graphviz.org>.

Source code: the unmodified official release tarball
<https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/16.0.0/graphviz-16.0.0.tar.gz>,
SHA-256 `36a1de1aaf5a2023b14f95170a5f8f0b12522d1c305b517fc261966597050749`.
Upstream repository: <https://gitlab.com/graphviz/graphviz>.

## viz-js 3.30.0

The WebAssembly build and its JavaScript wrapper are `dist/viz.cjs` from the npm package
[`@viz-js/viz`](https://www.npmjs.com/package/@viz-js/viz) 3.30.0 by Michael Daines, copied
byte for byte by `scripts/vendor-viz.sh`. MIT licensed (`licenses/VIZ-JS-LICENSE`; the npm
package itself ships no licence file). npm integrity
`sha512-2zmcP55QY44uQfZ+GvgNHmGd8S6KUD+2eMur9AbYybSzrOd/m8nMUg0ZircJNiJRKGgVBKAE8kh0hAwpUFUFQQ==`.

`vendor/viz/provenance.json` is the package's SLSA v1 build provenance (`lib/provenance.json`):
the backend was built from <https://github.com/mdaines/viz-js> revision
`99da545270e6e7b127a5c7ba65974b8a604a6358` (`packages/viz/backend/Dockerfile`) with
`emscripten/emsdk:5.0.7`, the Graphviz tarball above, and expat 2.8.4. `vendor/viz/SHA256SUMS`
pins the vendored files; the test suite checks it.

## Expat 2.8.4

Graphviz is linked with the Expat XML parser, MIT licensed (`licenses/EXPAT-COPYING`). Source:
<https://github.com/libexpat/libexpat/releases/download/R_2_8_4/expat-2.8.4.tar.gz>,
SHA-256 `b8ece2437692dad44d851c4532723390a5a330990007706be9c8d2b90d294f36`.

## Emscripten

The generated JavaScript and linked runtime contain Emscripten code, available under the MIT
and University of Illinois/NCSA licenses (`licenses/EMSCRIPTEN-LICENSE`).

## XML parser

`@xmldom/xmldom` 0.9.12 is a runtime dependency, installed from the npm registry and not
bundled, used to parse and rebuild Graphviz's SVG. Its MIT licence and attribution are in
`licenses/XMLDOM-LICENSE`.
