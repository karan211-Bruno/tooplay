const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function unpacked(binaryPath) {
  if (!binaryPath) return null;
  return binaryPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    .replace('app.asar/', 'app.asar.unpacked/');
}

function systemBinary(name) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(locator, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

function resolveBinary(bundledPath, name) {
  const candidate = unpacked(bundledPath);
  if (candidate && fs.existsSync(candidate)) return candidate;
  return systemBinary(name);
}

function ffmpegPath() {
  let bundled = null;
  try {
    bundled = require('ffmpeg-static');
  } catch {
    bundled = null;
  }
  return resolveBinary(bundled, 'ffmpeg');
}

function ffprobePath() {
  let bundled = null;
  try {
    bundled = require('ffprobe-static').path;
  } catch {
    bundled = null;
  }
  const candidate = unpacked(bundled);
  if (candidate && fs.existsSync(candidate)) return candidate;
  return systemBinary('ffprobe') || systemBinary('ffprobe.exe');
}

module.exports = { ffmpegPath, ffprobePath, unpacked };
