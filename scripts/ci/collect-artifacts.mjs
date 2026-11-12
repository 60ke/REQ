import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const targets = {
  'macos-arm64': 'aarch64-apple-darwin',
  'macos-x64': 'x86_64-apple-darwin',
  'windows-x64': 'x86_64-pc-windows-msvc',
};
const platform = process.env.REQ_PLATFORM;
const target = process.env.REQ_TARGET;
if (!platform || targets[platform] !== target)
  throw new Error('Expected a supported REQ_PLATFORM and matching REQ_TARGET.');
const root = process.cwd();
const bundle = path.join(root, 'src-tauri', 'target', target, 'release', 'bundle');
const output = path.join(root, 'artifacts', platform);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const copyMatching = async (directory, suffix) => {
  const from = path.join(bundle, directory);
  const files = (await readdir(from)).filter((name) => name.endsWith(suffix));
  if (!files.length) throw new Error(`No ${suffix} artifact was produced in ${from}.`);
  for (const name of files) {
    if (!(await stat(path.join(from, name))).isFile()) throw new Error(`Expected a file: ${name}`);
    await copyFile(path.join(from, name), path.join(output, name));
  }
};
if (platform.startsWith('macos-')) {
  await copyMatching('dmg', '.dmg');
  const appDirectory = path.join(bundle, 'macos');
  const apps = (await readdir(appDirectory)).filter((name) => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected exactly one macOS .app bundle.');
  // Uploading a raw .app through upload-artifact loses executable permissions.
  // ditto preserves the bundle, symlinks and resource metadata inside its ZIP.
  execFileSync(
    'ditto',
    [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      path.join(appDirectory, apps[0]),
      path.join(output, `Req-${platform}.app.zip`),
    ],
    { stdio: 'inherit' },
  );
} else {
  await copyMatching('nsis', '.exe');
  await copyMatching('msi', '.msi');
}
for (const filename of ['src-tauri/Cargo.lock', 'package-lock.json']) {
  await copyFile(path.join(root, filename), path.join(output, path.basename(filename)));
}
const sha256 = async (filename) =>
  createHash('sha256')
    .update(await readFile(filename))
    .digest('hex');
const commandVersion = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const metadata = {
  product: 'Req',
  version: packageInfo.version,
  platform,
  target,
  commit: process.env.GITHUB_SHA ?? 'local-uncommitted',
  sourceRef: process.env.GITHUB_REF ?? null,
  workflowRun: process.env.GITHUB_RUN_ID ?? null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  runnerOS: process.env.RUNNER_OS ?? process.platform,
  runnerArch: process.env.RUNNER_ARCH ?? process.arch,
  runnerImage: process.env.ImageOS ?? null,
  runnerImageVersion: process.env.ImageVersion ?? null,
  node: process.version,
  rust: commandVersion('rustc', ['--version', '--verbose']),
  cargo: commandVersion('cargo', ['--version']),
  tauriCli: JSON.parse(
    await readFile(path.join(root, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'),
  ).version,
  cargoLockSha256: await sha256(path.join(output, 'Cargo.lock')),
  npmLockSha256: await sha256(path.join(output, 'package-lock.json')),
  signing: platform.startsWith('macos-')
    ? 'ad-hoc only; no Apple Developer ID; not notarized'
    : 'unsigned; no Authenticode certificate',
  validation:
    'Frontend tests/build and native-core tests ran in the workflow. No installed-app GUI smoke test is included.',
  reproducibility:
    'Dependencies are locked within this run. Hosted runner images and SDKs can change; bit-for-bit reproducibility is not guaranteed.',
};
await writeFile(path.join(output, 'BUILD-METADATA.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(
  path.join(output, 'READ-ME-FIRST.txt'),
  [
    'Req development preview',
    `Platform: ${platform}`,
    `Signing: ${metadata.signing}`,
    'These are not verified production releases. Review the source and test with non-sensitive data.',
    'macOS Gatekeeper and Windows SmartScreen may warn or block installation. No operating-system security settings have been changed.',
    'Keep Cargo.lock and package-lock.json with these artifacts. Review and commit Cargo.lock before subsequent builds.',
    'The GitHub Actions artifact expires after 30 days. Save a local copy if you need to keep it.',
  ].join('\n') + '\n',
);
const checksums = [];
for (const name of (await readdir(output)).sort()) {
  if (name === 'SHA256SUMS.txt') continue;
  checksums.push(`${await sha256(path.join(output, name))}  ${name}`);
}
await writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(`Prepared ${checksums.length} files and checksums in ${output}`);
