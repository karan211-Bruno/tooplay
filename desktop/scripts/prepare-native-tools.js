const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ffprobe-static 3.1.0 labels an Intel binary as darwin/arm64.
// Use the same pinned upstream binary release as ffmpeg-static instead.
const URL = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64';
const SHA256 = 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64';
function ensureNativeProbe(rootDir) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
  const target = path.join(rootDir, 'node_modules', 'ffprobe-static', 'bin', 'darwin', 'arm64', 'ffprobe');
  if (fs.existsSync(target)) {
    const buffer = fs.readFileSync(target);
    if (buffer.readUInt32LE(0) === 0xfeedfacf && buffer.readUInt32LE(4) === 0x0100000c) return;
  }
  const cache = path.join(os.tmpdir(), `tooplay-ffprobe-${SHA256}`);
  if (!fs.existsSync(cache) || crypto.createHash('sha256').update(fs.readFileSync(cache)).digest('hex') !== SHA256) {
    execFileSync('/usr/bin/curl', ['-fsSL', '--retry', '2', '--max-time', '120', URL, '-o', cache], {stdio:'inherit'});
  }
  const content = fs.readFileSync(cache);
  if (crypto.createHash('sha256').update(content).digest('hex') !== SHA256) throw new Error('ffprobe checksum verification failed.');
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target,content,{mode:0o755}); fs.chmodSync(target,0o755);
  execFileSync('/usr/bin/xattr',['-cr',target]);
  execFileSync('/usr/bin/codesign',['--force','--sign','-',target],{stdio:'inherit'});
}
module.exports={ensureNativeProbe};
if(require.main===module) ensureNativeProbe(path.resolve(process.argv[2] || path.join(__dirname,'..')));
