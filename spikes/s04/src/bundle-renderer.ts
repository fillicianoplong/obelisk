import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const spikeRoot = path.resolve(__dirname, '..');
const outDir = path.join(spikeRoot, 'dist', 'www');

const hookSource = `'use strict';
(function () {
  var calls = [];
  globalThis.__s04Calls = calls;
  function note(kind, value) {
    calls.push({ kind: kind, body: String(value).slice(0, 180) });
  }
  // A Proxy around Function breaks async functions in this Chromium, so eval
  // and new Function are caught by the CSP violation log instead.
  if (typeof globalThis.Worker === 'function') {
    var OriginalWorker = globalThis.Worker;
    function WrappedWorker(url, options) {
      note('Worker', url);
      return new OriginalWorker(url, options);
    }
    WrappedWorker.prototype = OriginalWorker.prototype;
    globalThis.Worker = WrappedWorker;
  }
  window.addEventListener('error', function (event) {
    console.log('S04_ERROR ' + (event.message || 'error'));
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    console.log('S04_REJECT ' + reason);
  });
})();
`;

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Spike S-04</title>
  <link rel="stylesheet" href="./vendor/katex/katex.min.css">
  <link rel="stylesheet" href="./gallery.css">
</head>
<body>
  <div id="s04-root"></div>
  <script src="./hook.js"></script>
  <script type="module" src="./renderer.js"></script>
</body>
</html>
`;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main(): Promise<void> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'hook.js'), hookSource);
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);
  fs.copyFileSync(path.join(spikeRoot, 'src', 'gallery.css'), path.join(outDir, 'gallery.css'));
  fs.cpSync(path.join(spikeRoot, 'node_modules', 'katex', 'dist'), path.join(outDir, 'vendor', 'katex'), {
    recursive: true,
  });

  const result = await esbuild.build({
    entryPoints: [path.join(spikeRoot, 'src', 'renderer.ts')],
    bundle: true,
    format: 'esm',
    splitting: false,
    outfile: path.join(outDir, 'renderer.js'),
    platform: 'browser',
    target: 'chrome130',
    sourcemap: false,
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'info',
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.text).join('\n'));
  }

  const files = walk(outDir);
  const javascript = files.filter((file) => file.endsWith('.js'));
  const fonts = files.filter((file) => /\.(?:woff2?|ttf|otf)$/.test(file));
  const sum = (list: string[]) => list.reduce((total, file) => total + fs.statSync(file).size, 0);
  const rendererFile = path.join(outDir, 'renderer.js');
  const meta = {
    javascriptBytes: sum(javascript),
    rendererBytes: fs.statSync(rendererFile).size,
    fontBytes: sum(fonts),
    javascriptFiles: javascript.map((file) => path.relative(outDir, file)).sort(),
  };
  fs.writeFileSync(path.join(spikeRoot, 'dist', 'bundle-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`Renderer JavaScript ${meta.javascriptBytes} bytes, KaTeX fonts ${meta.fontBytes} bytes`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
