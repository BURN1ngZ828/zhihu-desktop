import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const assetsDir = path.join(root, 'dist', 'assets');
const assetFiles = fs.readdirSync(assetsDir);

// 1. Check renderer JS bundles: no transition-all & no blocking window.confirm
for (const file of assetFiles.filter((f) => f.endsWith('.js'))) {
  const js = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  if (/\btransition-all\b/.test(js)) {
    throw new Error(`[verify-build] Forbidden utility "transition-all" found in ${file}`);
  }
  if (/\bwindow\.confirm\b/.test(js)) {
    throw new Error(`[verify-build] Forbidden blocking "window.confirm" found in ${file}`);
  }
}

// 2. Check custom CSS & key tactile/motion rules
const cssContent = assetFiles
  .filter((f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
  .join('\n');

if (/transition\s*:\s*all\b/i.test(cssContent)) {
  throw new Error('[verify-build] Forbidden "transition: all" found in built CSS');
}
for (const requiredClass of ['inset-workspace-sheet', 'tactile-pill', 'prefers-reduced-motion']) {
  if (!cssContent.includes(requiredClass)) {
    throw new Error(`[verify-build] Missing required style contract "${requiredClass}" in built CSS`);
  }
}

// 3. Check Electron main bundle: Pin HTML sanitizer & 64-bit Snowflake ID safe JSON parser
const mainBundle = fs.readFileSync(path.join(root, 'dist-electron', 'main.cjs'), 'utf8');
if (!mainBundle.includes('sanitizePinTitle')) {
  throw new Error('[verify-build] Missing sanitizePinTitle in dist-electron/main.cjs');
}
if (!mainBundle.includes('parseJsonSafe') || !mainBundle.includes('isSafeInteger')) {
  throw new Error('[verify-build] Missing 64-bit Snowflake ID safe JSON parser in dist-electron/main.cjs');
}

// 4. Check package.json has zero runtime dependencies
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  throw new Error('[verify-build] Unexpected runtime "dependencies" in package.json (keep all in devDependencies)');
}

// 5. Check renderer source uses formatErrorMessage instead of leaking raw Electron IPC error prefix
for (const relPath of ['src/App.tsx', 'src/components/ReaderPane.tsx']) {
  const srcText = fs.readFileSync(path.join(root, relPath), 'utf8');
  if (/\berr\s+instanceof\s+Error\s*\?\s*err\.message\b/.test(srcText)) {
    throw new Error(`[verify-build] Raw "err instanceof Error ? err.message" found in ${relPath}; use formatErrorMessage()`);
  }
}

// 6. Check version consistency: no hardcoded version in SettingsModal, built JS includes pkg.version, lockfile matches
const settingsSrc = fs.readFileSync(path.join(root, 'src/components/SettingsModal.tsx'), 'utf8');
if (/知乎桌面端\s+v\d+\.\d+\.\d+/.test(settingsSrc)) {
  throw new Error('[verify-build] Hardcoded version found in src/components/SettingsModal.tsx; use __APP_VERSION__');
}
const allJsContent = assetFiles
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
  .join('\n');
if (!allJsContent.includes(pkg.version)) {
  throw new Error(`[verify-build] Built renderer JS does not contain current package.json version "${pkg.version}"`);
}
const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error(
      `[verify-build] package-lock.json version mismatch (root=${lock.version}, pkg=${lock.packages?.['']?.version}, expected=${pkg.version})`
    );
  }
}

console.log('[verify-build] All UX, motion, Pin sanitizer, IPC error hygiene, version sync, and zero-dependency guards passed');
