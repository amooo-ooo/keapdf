import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

/**
 * Ensures a valid, uncorrupted esbuild binary is available for Wrangler on Windows.
 * On WinBtrfs volumes, large binary file copies can occasionally suffer sparse extent corruption.
 * This script detects unexecutable binaries and restores them via symlink to the global Bun cache.
 */
function ensureEsbuild() {
  if (process.platform !== 'win32') return;

  const targetBin = path.resolve(
    'node_modules/wrangler/node_modules/esbuild/node_modules/@esbuild/win32-x64/esbuild.exe'
  );

  function isBinaryWorking(binPath) {
    try {
      if (!fs.existsSync(binPath)) return false;
      const res = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 4000 });
      return res.status === 0 && Boolean(res.stdout && res.stdout.trim().length > 0);
    } catch {
      return false;
    }
  }

  if (isBinaryWorking(targetBin)) {
    return;
  }

  console.log('[ensure-esbuild] Wrangler esbuild binary is invalid or corrupted. Finding healthy binary...');

  const bunCacheEsbuildDir = path.join(os.homedir(), '.bun/install/cache/@esbuild');
  let healthyBin = null;

  if (fs.existsSync(bunCacheEsbuildDir)) {
    try {
      const candidates = fs
        .readdirSync(bunCacheEsbuildDir)
        .filter((dir) => dir.startsWith('win32-x64'))
        .sort()
        .reverse();

      for (const dir of candidates) {
        const candidatePath = path.join(bunCacheEsbuildDir, dir, 'esbuild.exe');
        if (isBinaryWorking(candidatePath)) {
          healthyBin = candidatePath;
          break;
        }
      }
    } catch (e) {
      console.warn('[ensure-esbuild] Error reading bun cache:', e);
    }
  }

  if (!healthyBin) {
    const fallback = path.resolve('node_modules/@esbuild/win32-x64/esbuild.exe');
    if (isBinaryWorking(fallback)) {
      healthyBin = fallback;
    }
  }

  if (healthyBin) {
    try {
      try {
        fs.unlinkSync(targetBin);
      } catch {}
      fs.mkdirSync(path.dirname(targetBin), { recursive: true });
      fs.symlinkSync(healthyBin, targetBin);
      console.log(`[ensure-esbuild] Created symlink from ${healthyBin} to ${targetBin}`);
    } catch (err) {
      console.warn(`[ensure-esbuild] Could not create symlink: ${err.message}`);
    }
  } else {
    console.warn('[ensure-esbuild] No healthy esbuild binary found in cache.');
  }
}

ensureEsbuild();
