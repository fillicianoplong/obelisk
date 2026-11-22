import fs from 'node:fs';
import path from 'node:path';

const AFF = 'en-US.aff';
const DIC = 'en-US.dic';

export function bundledDictionary(appPath: string): { aff: string; dic: string } | null {
  const roots = [
    path.join(appPath, 'assets', 'spell'),
  ];
  for (const root of roots) {
    const aff = path.join(root, AFF);
    const dic = path.join(root, DIC);
    if (fs.existsSync(aff) && fs.existsSync(dic)) {
      return { aff, dic };
    }
  }
  return null;
}
