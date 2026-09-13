/**
 * Packaging claims must be true of the tree that gets packed.
 *
 * npm translation of the Python packages' packaging guards
 * (sdks/mudraid-sdk-python/tests/unit/test_packaging_metadata.py and
 * sdks/mudraid-middleware-python/tests/unit/test_version_single_source.py).
 * These tests hold the METADATA to its promises; what ends up inside the
 * built tarball is asserted separately by `.github/inspect_tarball.mjs`,
 * which publish.yml runs against the actual artifact after `npm pack` —
 * the same split as pytest vs `inspect_distribution.py` on the Python side.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
const manifest = readJson(join(PACKAGE_ROOT, 'package.json'));

/**
 * The support matrix is the authority on which version is publishable; a
 * manifest that has moved past it would publish an artifact nothing declares.
 *
 * Two layouts, one guard. In the monorepo this package lives under `sdks/`
 * and the full matrix sits one level above the package root. In a public
 * mirror the package root IS the repository root and a trimmed excerpt of the
 * matrix — this package's own name and version — ships alongside the package
 * (see .github/workflows/mirror-sdk.yml, "Ship the package's support-matrix
 * excerpt"). Absence in BOTH places is a failure, not a skip: the publish run
 * in the public repository is the only run that uploads, which makes it
 * exactly the run this guard exists for.
 */
function matrixRow(name: string): any {
  const candidates = [
    join(PACKAGE_ROOT, 'support-matrix.json'), // public mirror layout
    join(PACKAGE_ROOT, '..', 'support-matrix.json'), // monorepo layout
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      'support-matrix.json exists neither beside the package (mirror layout) nor ' +
        'one level up (monorepo layout); the publishable-version guard has nothing ' +
        'to hold the manifest against',
    );
  }
  const row = readJson(found).packages.find((p: any) => p.name === name);
  expect(row, `${found} has no row for ${name}`).toBeDefined();
  return row;
}

describe('version single-source', () => {
  it('declares in package.json the version the support matrix publishes', () => {
    // Pinned literally, as the Python guard pins "1.1.0": bumping the version
    // is a deliberate multi-file act — manifest, lockfile, matrix row, this
    // test — never a drive-by edit that two of the four fail to notice.
    const row = matrixRow('@mudraid/adapter-node');
    expect(manifest.version).toBe(row.version);
    expect(manifest.version).toBe('1.1.0');
  });

  it('keeps the lockfile agreeing with the manifest', () => {
    // npm's own drift point: `npm version`/hand edits touch package.json and
    // package-lock.json records the version TWICE (top level and the ""
    // entry). A lockfile left behind ships nothing wrong by itself, but it is
    // the first "which version is this really?" question a release audit hits.
    const lock = readJson(join(PACKAGE_ROOT, 'package-lock.json'));
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[''].version).toBe(manifest.version);
  });

  it('claims in the matrix only what the manifest can deliver', () => {
    const row = matrixRow('@mudraid/adapter-node');
    // The excerpt shipped to a public mirror carries name + version only;
    // these fields exist in the monorepo layout, where the claims live.
    if (row.support_status !== undefined) {
      // "On the receipt, not the vibe": a manifest still marked private
      // cannot have produced a recorded upload, so the row may claim nothing
      // beyond prerelease. The row flips only after an upload is recorded.
      if (manifest.private === true) {
        expect(row.support_status).toBe('prerelease');
      }
    }
    if (row.runtimes !== undefined) {
      expect(row.runtimes).toContain(`node${manifest.engines.node}`);
    }
  });
});

describe('packaging metadata', () => {
  it('declares the public publisher repository required by npm provenance', () => {
    expect(manifest.repository).toEqual({type: 'git', url: 'git+https://github.com/MudraID/mudraid-adapter-node.git'});
  });
  it('either declares a licence and ships its text, or explicitly declares none', () => {
    // Analogue of the Python "classifier and marker agree" guard: a licence
    // id nobody can read the text of is worse than UNLICENSED, because it is
    // believed. Either both, or neither.
    const shipsText = existsSync(join(PACKAGE_ROOT, 'LICENSE'));
    expect(manifest.license !== 'UNLICENSED').toBe(shipsText);
  });

  it('points every entry surface inside the files allowlist', () => {
    // `main`, `types` and each `exports` target must live under a prefix the
    // `files` allowlist actually packs — otherwise npm quietly ships a
    // manifest whose doors open onto nothing.
    const allow: string[] = manifest.files;
    expect(allow?.length).toBeGreaterThan(0);
    const targets = [
      manifest.main,
      manifest.types,
      ...Object.values(manifest.exports ?? {}).flatMap((entry: any) =>
        typeof entry === 'string' ? [entry] : Object.values(entry),
      ),
    ].filter((t): t is string => typeof t === 'string');
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const rel = target.replace(/^\.\//, '');
      expect(
        allow.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`)),
        `${target} is not under any files[] prefix ${JSON.stringify(allow)}`,
      ).toBe(true);
    }
  });

  it('compiles the build to the layout the manifest promises', () => {
    // Regression guard for the defect this machinery was born catching: the
    // base tsconfig's `rootDir: "."` made `tsc -p tsconfig.build.json` emit
    // `dist/src/index.js` while main/types/exports name `dist/index.js`.
    // Every in-tree test stayed green; only an installed consumer broke.
    // tsconfig files are JSONC — full-line // comments carry the reasoning —
    // so strip those before parsing.
    const raw = readFileSync(join(PACKAGE_ROOT, 'tsconfig.build.json'), 'utf8');
    const build = JSON.parse(
      raw
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n'),
    );
    expect(build.compilerOptions?.rootDir).toBe('src');
    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.types).toBe('./dist/index.d.ts');
  });

  it('packs the source surface and none of the forbidden classes', () => {
    // `npm pack --dry-run --json` is npm's own statement of what it would
    // ship. Source-tree entries are asserted here; the built `dist/` entries
    // are asserted by .github/inspect_tarball.mjs against the real tarball in
    // publish.yml, after the build that creates them.
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files: string[] = JSON.parse(out)[0].files.map((f: any) => f.path);

    expect(files).toContain('package.json');
    expect(files).toContain('src/index.ts');

    const forbidden: Array<[RegExp, string]> = [
      [/(^|\/)\.env($|\..*)/, 'environment files carry credentials by convention'],
      [/\.(pem|key|p12|pfx|jks)$/, 'private key material'],
      [/(^|\/)\.npmrc$/, 'npm credentials'],
      [/(^|\/)\.git(hub)?($|\/)/, 'repository internals / CI furniture'],
      [/(^|\/)node_modules($|\/)/, 'a dependency tree from the build machine'],
      [/(^|\/)test($|\/)/, 'the suite runs in the repository, not out of the tarball'],
      [/(vitest\.config|tsconfig(\..+)?\.json)/, 'build/test configuration'],
      [/\.tgz$/, 'a stale packed artifact'],
    ];
    for (const [pattern, reason] of forbidden) {
      const hits = files.filter((f) => pattern.test(f));
      expect(hits, `tarball would ship ${JSON.stringify(hits)} — ${reason}`).toEqual([]);
    }
  });
});
