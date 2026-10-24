import { runNode, tsc } from './tools.mjs';

runNode(tsc, ['-p', 'tsconfig.build.json', '--pretty', 'false', '--noEmit']);
runNode(tsc, ['-p', 'tsconfig.renderer.json', '--pretty', 'false']);
runNode(tsc, ['-p', 'tsconfig.node.json', '--pretty', 'false']);
