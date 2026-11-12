import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const collector = fileURLToPath(new URL('./collect-artifacts.mjs', import.meta.url));
const unixOnly = { skip: process.platform === 'win32' };
async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'req-ci-test-'));
  const target = 'x86_64-pc-windows-msvc';
  const bundle = path.join(root, 'src-tauri/target', target, 'release/bundle');
  const bin = path.join(root, 'mock-tools');
  try {
    for (const dir of [
      bin,
      `${bundle}/nsis`,
      `${bundle}/msi`,
      `${root}/node_modules/@tauri-apps/cli`,
    ])
      await mkdir(dir, { recursive: true });
    await writeFile(
      `${root}/src-tauri/Cargo.lock`,
      '# synthetic lockfile for collection tests only\n',
    );
    await writeFile(`${root}/package-lock.json`, '{}\n');
    await writeFile(`${root}/package.json`, '{"version":"0.1.0-test"}');
    await writeFile(`${root}/node_modules/@tauri-apps/cli/package.json`, '{"version":"test-only"}');
    await writeFile(`${bundle}/nsis/test-setup.exe`, 'synthetic installer fixture, not a binary');
    await writeFile(`${bundle}/msi/test.msi`, 'synthetic MSI fixture, not a binary');
    for (const tool of ['cargo', 'rustc'])
      await writeFile(`${bin}/${tool}`, `#!/bin/sh\nprintf '${tool} test-fixture-only\\n'\n`, {
        mode: 0o755,
      });
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      REQ_PLATFORM: 'windows-x64',
      REQ_TARGET: target,
    };
    const run = () =>
      execFileSync(process.execPath, [collector], {
        cwd: root,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    await callback({ root, bundle, env, run });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test(
  'collects required files, records lock hashes, and generates verifiable checksums',
  unixOnly,
  async () => {
    await fixture(async ({ root, run }) => {
      run();
      const output = path.join(root, 'artifacts/windows-x64');
      const metadata = JSON.parse(await readFile(`${output}/BUILD-METADATA.json`, 'utf8'));
      assert.equal(metadata.platform, 'windows-x64');
      assert.match(metadata.signing, /^unsigned/);
      const checksumLines = (await readFile(`${output}/SHA256SUMS.txt`, 'utf8')).trim().split('\n');
      assert.equal(checksumLines.length, 6);
      for (const line of checksumLines) {
        const [hash, filename] = line.split('  ');
        assert.equal(
          hash,
          createHash('sha256')
            .update(await readFile(path.join(output, filename)))
            .digest('hex'),
        );
      }
      await writeFile(`${output}/stale.exe`, 'old artifact');
      run();
      await assert.rejects(readFile(`${output}/stale.exe`));
    });
  },
);

test('fails rather than uploading a partial Windows artifact set', unixOnly, async () => {
  await fixture(async ({ bundle, run }) => {
    await rm(`${bundle}/msi/test.msi`);
    assert.throws(run, /No \.msi artifact was produced/);
  });
});

test('rejects unknown target/platform combinations before copying', unixOnly, async () => {
  await fixture(async ({ env, run }) => {
    env.REQ_TARGET = 'aarch64-apple-darwin';
    assert.throws(run, /supported REQ_PLATFORM and matching REQ_TARGET/);
  });
});
