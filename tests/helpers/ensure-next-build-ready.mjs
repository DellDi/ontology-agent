import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BUILD_INPUT_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'src',
  'drizzle',
];
const LOCK_DIR_NAME = '.next/test-build.lock';
const META_FILE_NAME = '.next/test-build-meta.json';

async function collectFingerprintEntries(rootDir, relativePath, entries) {
  const absolutePath = path.join(rootDir, relativePath);

  try {
    const info = await stat(absolutePath);

    if (info.isDirectory()) {
      const children = await readdir(absolutePath, {
        withFileTypes: true,
      });

      for (const child of children.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        await collectFingerprintEntries(
          rootDir,
          path.join(relativePath, child.name),
          entries,
        );
      }

      return;
    }

    entries.push(
      `${relativePath}:${info.size}:${Math.trunc(info.mtimeMs)}`,
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function computeBuildFingerprint(rootDir) {
  const entries = [];

  for (const relativePath of BUILD_INPUT_PATHS) {
    await collectFingerprintEntries(rootDir, relativePath, entries);
  }

  const hash = createHash('sha256');
  hash.update(entries.join('\n'));

  return hash.digest('hex');
}

async function readBuildMeta(metaFilePath) {
  try {
    const content = await readFile(metaFilePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function waitForLockRelease(lockDirPath) {
  const start = Date.now();

  while (Date.now() - start < 600_000) {
    try {
      await stat(lockDirPath);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Timed out while waiting for another test build to finish.');
}

export async function ensureNextBuildReady({ cwd, env }) {
  const buildFingerprint = await computeBuildFingerprint(cwd);
  const lockDirPath = path.join(cwd, LOCK_DIR_NAME);
  const metaFilePath = path.join(cwd, META_FILE_NAME);
  const buildIdPath = path.join(cwd, '.next/BUILD_ID');

  while (true) {
    try {
      await mkdir(lockDirPath, {
        recursive: false,
      });
      break;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        await waitForLockRelease(lockDirPath);
        const meta = await readBuildMeta(metaFilePath);

        try {
          await stat(buildIdPath);
          if (meta?.fingerprint === buildFingerprint) {
            return;
          }
        } catch {
          // Ignore and loop to acquire the lock.
        }

        continue;
      }

      throw error;
    }
  }

  try {
    const meta = await readBuildMeta(metaFilePath);

    try {
      await stat(buildIdPath);
      if (meta?.fingerprint === buildFingerprint) {
        return;
      }
    } catch {
      // Build output missing or stale; rebuild below.
    }

    await execFileAsync('pnpm', ['build'], {
      cwd,
      env,
    });

    await writeFile(
      metaFilePath,
      JSON.stringify(
        {
          fingerprint: buildFingerprint,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  } finally {
    await rm(lockDirPath, {
      recursive: true,
      force: true,
    });
  }
}
