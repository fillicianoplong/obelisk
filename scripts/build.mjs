import { root, runNode, tsc, viteBin } from './tools.mjs';

runNode(tsc, ['-p', 'tsconfig.build.json', '--pretty', 'false']);
runNode(tsc, ['-p', 'tsconfig.renderer.json', '--pretty', 'false']);
runNode(tsc, ['-p', 'tsconfig.node.json', '--pretty', 'false']);
runNode(`${root}/scripts/copy-katex-assets.mjs`, []);
runNode(`${root}/scripts/generate-page-font-css.mjs`, []);
runNode(`${root}/scripts/generate-editor-format-css.mjs`, []);
runNode(`${root}/scripts/generate-license-notices.mjs`, []);
runNode(`${root}/scripts/generate-about-notices.mjs`, []);
runNode(viteBin, ['build']);
runNode(viteBin, ['build', '--config', 'vite.preload.config.mts']);
runNode(`${root}/scripts/copy-license-resources.mjs`, []);
