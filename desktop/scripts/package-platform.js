const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { copyData, copyProductionDependencies, prepareDependencies } = require('./runtime-files');

const target = process.argv[2];
if (!['win', 'linux'].includes(target)) throw new Error('Usage: node scripts/package-platform.js win|linux [output-directory]');
const rootDir = path.join(__dirname, '..');
const platform = target === 'win' ? 'win32' : 'linux';
const arch = 'x64';
const output = path.resolve(process.argv[3] || path.join(rootDir, 'dist'));
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), `tooplay-${target}-build-`));
process.on('exit', () => fs.rmSync(stage, { recursive: true, force: true }));
function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', timeout: 900000, ...options });
}
for (const dir of ['src', 'assets']) copyData(path.join(rootDir, dir), path.join(stage, dir));
const buildOutput = path.join(stage, 'dist');
const config = {
  ...manifest.build,
  electronVersion: require('electron/package.json').version,
  directories: { ...manifest.build.directories, output: buildOutput },
  // Leave resource editing enabled; no distribution certificate is configured.
  win: { ...manifest.build.win, signExecutable: false },
  linux: { ...manifest.build.linux, target: ['AppImage'], syncDesktopName: true }
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  ...manifest, desktopName: "com.tooplay.cross", devDependencies: {}, build: config
}, null, 2));
const dependencyRoot = prepareDependencies(rootDir);
copyProductionDependencies(stage, { rootDir: dependencyRoot, rootPackage: manifest, platform, arch });
const ffmpegDir = path.join(stage, 'node_modules', 'ffmpeg-static');
for (const name of ['ffmpeg', 'ffmpeg.exe']) fs.rmSync(path.join(ffmpegDir, name), { force: true });
const executable = path.join(ffmpegDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
console.log(`Downloading ${platform}-${arch} ffmpeg…`);
run(process.execPath, [path.join(dependencyRoot, 'node_modules', 'ffmpeg-static', 'install.js')], {
  env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch, FFMPEG_BIN: executable, CI: '1' }
});
const header = fs.readFileSync(executable).subarray(0,4);
if (platform === 'win32' ? header.toString('ascii',0,2) !== 'MZ' : header.toString('hex') !== '7f454c46') {
  throw new Error('The downloaded ffmpeg binary does not match the target platform.');
}
console.log(`Building Tooplay for ${platform}-${arch}…`);
run(process.execPath, [path.join(dependencyRoot, 'node_modules', 'electron-builder', 'cli.js'),
  `--${target}`, '--x64', '--projectDir', stage], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
if (target === 'linux') require('./build-deb').buildDeb(path.join(buildOutput, 'linux-unpacked'), buildOutput, manifest.version);
fs.mkdirSync(output, { recursive: true });
for (const file of fs.readdirSync(buildOutput)) {
  if (/\.(exe|AppImage|deb|blockmap)$/.test(file) && !file.includes('__uninstaller')) copyData(path.join(buildOutput, file), path.join(output, file));
}
console.log(`Created ${target} packages in ${output}`);
