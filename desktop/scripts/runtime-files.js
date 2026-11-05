const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Read and write data only: copying File Provider extended attributes can stall cp.
function copyData(source, destination, runtimeOnly = false) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (['test', 'tests', 'examples', '.git', 'coverage'].includes(entry)) continue;
      copyData(path.join(source, entry), path.join(destination, entry), runtimeOnly);
    }
  } else if (!runtimeOnly || /\.(js|cjs|mjs|json|proto|node)$|^(LICENSE|LICENCE|COPYING)/i.test(path.basename(source))) {
    fs.writeFileSync(destination, fs.readFileSync(source), { mode: stat.mode & 0o777 });
  }
}

function findPackageDir(name, fromDir) {
  let current = fromDir;

  while (true) {
    const candidate = path.join(current, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Cannot resolve package: ${name} (from ${fromDir})`);
}

function copyProductionDependencies(appDir, { rootDir, rootPackage, platform = process.platform, arch = process.arch }) {
  const queue = Object.keys({
    ...(rootPackage.dependencies || {}),
    ...(rootPackage.optionalDependencies || {})
  }).map((name) => ({ name, fromDir: rootDir }));
  const visited = new Set();

  while (queue.length) {
    const { name, fromDir } = queue.shift();
    let packageDir;
    try { packageDir = findPackageDir(name, fromDir); }
    catch (error) {
      const parent = JSON.parse(fs.readFileSync(path.join(fromDir, 'package.json'), 'utf8'));
      if (Object.hasOwn(parent.optionalDependencies || {}, name)) continue;
      throw error;
    }
    if (visited.has(packageDir)) continue;
    visited.add(packageDir);

    const relative = path.relative(rootDir, packageDir);
    if (!relative || relative.startsWith('..')) {
      throw new Error(`Package is outside the project: ${packageDir}`);
    }

    console.log(`Copying ${name}`);
    const destination = path.join(appDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (name === 'ffprobe-static') {
      fs.mkdirSync(destination, { recursive: true });
      for (const entry of fs.readdirSync(packageDir)) {
        if (entry !== 'bin') copyData(path.join(packageDir, entry), path.join(destination, entry), true);
      }
      const binaryDir = path.join('bin', platform, arch);
      fs.mkdirSync(path.join(destination, binaryDir), { recursive: true });
      const binary = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
      copyData(path.join(packageDir, binaryDir, binary), path.join(destination, binaryDir, binary));
    } else {
      copyData(packageDir, destination, name !== 'ffmpeg-static');
    }

    const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    if (name === 'ffmpeg-static') {
      const runtimeManifest = { ...packageJson, dependencies: {}, scripts: {} };
      fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(runtimeManifest, null, 2));
    }
    const dependencies = {
      ...(name === 'ffmpeg-static' ? {} : packageJson.dependencies || {}),
      ...(packageJson.optionalDependencies || {})
    };

    for (const dependency of Object.keys(dependencies)) {
      queue.push({ name: dependency, fromDir: packageDir });
    }
  }

  console.log(`Copied ${visited.size} production packages.`);
}

function prepareDependencies(rootDir) {
  if (process.env.TOOPLAY_DEPENDENCIES) return process.env.TOOPLAY_DEPENDENCIES;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-dependencies-'));
  process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'package-lock.json']) copyData(path.join(rootDir, file), path.join(directory, file));
  const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  const npmCLI = process.env.npm_execpath;
  const command = npmCLI ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const prefix = npmCLI ? [npmCLI] : [];
  const run = (offline) => execFileSync(command, [...prefix, ...args, ...(offline ? ['--offline'] : [])], {
    cwd: directory, stdio: 'inherit', timeout: 300000, shell: !npmCLI && process.platform === 'win32'
  });
  try { run(true); } catch { run(false); }
  // ffmpeg-static's install dependencies are only needed for the target download.
  return directory;
}

module.exports = { copyData, copyProductionDependencies, prepareDependencies };
