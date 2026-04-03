import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, '..');
const source = path.join(runtimeRoot, 'bin', 'ccmh');

function main() {
  const customDir = process.env.CCMH_BIN_DIR?.trim();
  const binDir = customDir || path.join(os.homedir(), '.local', 'bin');
  const target = path.join(binDir, 'ccmh');

  mkdirSync(binDir, { recursive: true });

  if (existsSync(target)) {
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        const current = readlinkSync(target);
        if (path.resolve(binDir, current) === source || path.resolve(current) === source) {
          console.log(`ccmh already installed at: ${target}`);
          return;
        }
      }
    } catch {}
    rmSync(target, { force: true });
  }

  symlinkSync(source, target);

  console.log(`Installed ccmh: ${target}`);
  if (!process.env.PATH?.split(':').includes(binDir)) {
    console.log('');
    console.log('Add this to your shell profile if needed:');
    console.log(`export PATH="${binDir}:$PATH"`);
  }
}

main();
