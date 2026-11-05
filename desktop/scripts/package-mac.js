const fs = require('fs');
const path = require('path');
const os = require('os');
const { copyData, copyProductionDependencies, prepareDependencies } = require('./runtime-files');
const { execFileSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outputArg = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const outputApp = path.resolve(outputArg || path.join(rootDir, 'dist', 'Tooplay.app'));
const electronApp = path.join(rootDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const skipSigning = process.argv.includes('--skip-sign');

if (process.platform !== 'darwin') throw new Error('macOS에서 실행해 주세요.');
if (!outputApp.endsWith('.app') || outputApp === electronApp || outputApp === rootDir) {
  throw new Error('Output path must end with .app');
}
if (!fs.existsSync(electronApp)) {
  throw new Error('Electron is not installed. Run "npm install" first.');
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', timeout: 180000, ...options });
}

function updateInfoPlist(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const replacements = [
    ['CFBundleExecutable', 'Tooplay'],
    ['CFBundleDisplayName', 'Tooplay'],
    ['CFBundleName', 'Tooplay'],
    ['CFBundleIdentifier', 'com.tooplay.cross'],
    ['CFBundleIconFile', 'icon.icns'],
    ['CFBundleShortVersionString', rootPackage.version],
    ['CFBundleVersion', rootPackage.version],
    ['LSApplicationCategoryType', 'public.app-category.video'],
    ['NSLocalNetworkUsageDescription', 'Chromecast(Google TV) 기기를 찾기 위해 같은 네트워크를 검색합니다.']
  ];

  for (const [key, value] of replacements) {
    run('plutil', ['-replace', key, '-string', value, plist]);
  }

  run('plutil', ['-replace', 'CFBundleDocumentTypes', '-json', JSON.stringify([{
    CFBundleTypeName: 'Video', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate',
    CFBundleTypeExtensions: ['mp4', 'm4v', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'ts', 'm2ts', 'mpg', 'mpeg', 'vob', 'ogv', '3gp']
  }]), plist]);
  run('plutil', ['-replace', 'NSBonjourServices', '-json', '["_googlecast._tcp"]', plist]);
  try {
    run('plutil', ['-remove', 'ElectronAsarIntegrity', plist], { stdio: 'ignore' });
  } catch {
    // The key is optional.
  }
}

async function packageMac() {
console.log(`Packaging ${outputApp}`);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tooplay-package-'));
const stagedApp = path.join(stage, 'Tooplay.app');
process.on('exit', () => fs.rmSync(stage, { recursive: true, force: true }));
run('cp', ['-Rc', electronApp, stagedApp]);
const contentsDir = path.join(stagedApp, 'Contents');
fs.renameSync(path.join(contentsDir, 'MacOS', 'Electron'), path.join(contentsDir, 'MacOS', 'Tooplay'));
const resourcesDir = path.join(contentsDir, 'Resources');
const appDir = path.join(resourcesDir, 'app');

fs.rmSync(path.join(resourcesDir, 'default_app.asar'), { force: true });
fs.mkdirSync(appDir, { recursive: true });

for (const directory of ['src', 'assets']) {
  copyData(path.join(rootDir, directory), path.join(appDir, directory));
}

const runtimePackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  private: true,
  main: rootPackage.main,
  dependencies: rootPackage.dependencies
};
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(runtimePackage, null, 2));
const dependencyRoot = prepareDependencies(rootDir);
require('./prepare-native-tools').ensureNativeProbe(dependencyRoot);
const bundledFFmpeg = path.join(dependencyRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
if (!fs.existsSync(bundledFFmpeg)) {
  const installed = path.join(rootDir, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (fs.existsSync(installed)) copyData(installed, bundledFFmpeg);
  else run(process.execPath, [path.join(dependencyRoot, 'node_modules', 'ffmpeg-static', 'install.js')], { env: { ...process.env, FFMPEG_BIN: bundledFFmpeg } });
}
copyProductionDependencies(appDir, { rootDir: dependencyRoot, rootPackage });

run('cp', ['-Rc', path.join(rootDir, 'assets', 'icon.icns'), path.join(resourcesDir, 'icon.icns')]);
updateInfoPlist(stagedApp);

console.log('Creating app.asar…');
await require(path.join(dependencyRoot, 'node_modules', '@electron', 'asar')).createPackageWithOptions(appDir, path.join(resourcesDir, 'app.asar'), {
  unpack: '**/ffmpeg-static/ffmpeg', unpackDir: '**/ffprobe-static'
});
fs.rmSync(appDir, { recursive: true, force: true });
run('xattr', ['-cr', stagedApp]);
if (!skipSigning) {
  run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', stagedApp]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', stagedApp]);
}
fs.mkdirSync(path.dirname(outputApp), { recursive: true });
fs.rmSync(outputApp, { recursive: true, force: true });
run('ditto', ['--noextattr', '--noqtn', stagedApp, outputApp]);
run('xattr', ['-cr', outputApp]);
if (!skipSigning) {
  try { run('codesign', ['--verify', '--deep', '--strict', outputApp]); }
  catch { console.warn('동기화 폴더가 Finder 속성을 추가했습니다. DMG 안의 서명된 앱을 Applications에 복사해 사용하세요.'); }
}
if (process.argv.includes('--dmg')) {
  const imageRoot = path.join(stage, 'image');
  fs.mkdirSync(imageRoot);
  run('cp', ['-Rc', stagedApp, path.join(imageRoot, 'Tooplay.app')]);
  fs.symlinkSync('/Applications', path.join(imageRoot, 'Applications'));
  const imagePath = path.join(path.dirname(outputApp), `Tooplay-${rootPackage.version}-mac-${process.arch}.dmg`);
  run('hdiutil', ['create', '-volname', 'Tooplay', '-srcfolder', imageRoot, '-ov', '-format', 'UDZO', imagePath]);
  run('hdiutil', ['verify', imagePath]);
  console.log(`Created: ${imagePath}`);
}

console.log(`\nCreated: ${outputApp}`);

}
packageMac().catch((error) => { console.error(error); process.exitCode = 1; });
