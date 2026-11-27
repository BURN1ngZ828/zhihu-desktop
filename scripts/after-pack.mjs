import fs from 'node:fs';
import path from 'node:path';

export default async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;
  const keep = new Set(['zh-CN.pak', 'en-US.pak']);
  let removed = 0;
  for (const file of fs.readdirSync(localesDir)) {
    if (!keep.has(file)) {
      fs.unlinkSync(path.join(localesDir, file));
      removed++;
    }
  }
  console.log(`[afterPack] Pruned ${removed} unused locale files`);
}
