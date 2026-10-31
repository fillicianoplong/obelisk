import { root, runNode, tsc, viteBin } from './tools.mjs';

runNode(tsc, ['-p', 'tsconfig.build.json', '--pretty', 'false']);
runNode(tsc, ['-p', 'tsconfig.renderer.json', '--pretty', 'false']);
runNode(tsc, ['-p', 'tsconfig.node.json', '--pretty', 'false']);
runNode(`${root}/scripts/generate-editor-format-css.mjs`, []);
runNode(viteBin, ['build']);
runNode(viteBin, ['build', '--config', 'vite.preload.config.mts']);
