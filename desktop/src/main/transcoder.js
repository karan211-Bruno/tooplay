const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

let cachedEncoder = null;

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function detectEncoder(ffmpeg) {
  if (cachedEncoder) return cachedEncoder;

  try {
    const { stdout } = await execFileAsync(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10000, windowsHide: true });
    cachedEncoder = stdout.includes('h264_videotoolbox') ? 'h264_videotoolbox' : 'libx264';
  } catch {
    cachedEncoder = 'libx264';
  }

  return cachedEncoder;
}

class Transcoder {
  constructor({ ffmpeg, input, outputDirectory, encoder, purpose = 'local', startTime = 0, onProgress, onReady, onError, onFinished }) {
    this.ffmpeg = ffmpeg;
    this.input = input;
    this.outputDirectory = outputDirectory;
    this.encoder = encoder;
    this.purpose = purpose;
    this.startTime = Math.max(0, Number(startTime) || 0);
    this.onProgress = onProgress || (() => {});
    this.onReady = onReady || (() => {});
    this.onError = onError || (() => {});
    this.onFinished = onFinished || (() => {});

    this.process = null;
    this.timer = null;
    this.stderr = '';
    this.progressBuffer = '';
    this.ready = false;
    this.finished = false;
    this.cancelled = false;
    this.startedAt = Date.now();
    this.duration = 0;
    this.availableDuration = 0;
  }

  setDuration(duration) {
    this.duration = Number(duration) || 0;
  }

  start() {
    fs.mkdirSync(this.outputDirectory, { recursive: true });

    const playlist = path.join(this.outputDirectory, 'index.m3u8');
    const segment = path.join(this.outputDirectory, 'seg%05d.ts');
    const cast = this.purpose === 'cast';
    const encoderArgs = cast
      ? ['-c:v', this.encoder === 'h264_videotoolbox' ? 'h264_videotoolbox' : 'libx264',
        ...(this.encoder === 'h264_videotoolbox' ? ['-allow_sw', '1'] : ['-preset', 'veryfast']),
        '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '6000k',
        '-profile:v', 'main', '-level:v', '3.1', '-g', '60']
      : this.encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '8M', '-bufsize', '12M'];

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-nostdin',
      '-nostats',
      '-progress', 'pipe:1',
      '-y',
      ...(this.startTime > 0 ? ['-ss', String(this.startTime)] : []),
      '-i', this.input,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-sn',
      '-dn',
      ...encoderArgs,
      '-vf', cast ? 'scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1' : "scale='trunc(min(iw,1920)/2)*2':-2",
      '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-c:a', 'aac',
      '-b:a', cast ? '128k' : '192k',
      '-ac', '2',
      '-ar', '48000',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_playlist_type', 'event',
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_filename', segment,
      playlist
    ];

    const child = spawn(this.ffmpeg, args, { windowsHide: true });
    this.process = child;

    child.stdout.on('data', (data) => this.consumeProgress(data.toString('utf8')));

    child.stderr.on('data', (data) => {
      this.stderr += data.toString('utf8');
      if (this.stderr.length > 8000) {
        this.stderr = this.stderr.slice(-8000);
      }
    });

    child.on('error', (error) => {
      if (this.cancelled) return;
      this.fail(`ffmpeg를 실행할 수 없습니다: ${error.message}`);
    });

    child.on('close', (code) => this.handleClose(code));

    this.timer = setInterval(() => this.checkPlaylist(), 250);
  }

  consumeProgress(text) {
    this.progressBuffer += text;
    const lines = this.progressBuffer.split('\n');
    this.progressBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('out_time_us=')) {
        const microseconds = Number(line.slice('out_time_us='.length));
        if (Number.isFinite(microseconds) && this.duration > 0) {
          const value = microseconds / 1_000_000 / this.duration;
          this.onProgress(Math.max(0, Math.min(1, value)));
        }
      } else if (line === 'progress=end') {
        this.onProgress(1);
      }
    }
  }

  checkPlaylist() {
    if (this.cancelled || this.finished) return;

    const playlist = path.join(this.outputDirectory, 'index.m3u8');
    try {
      const text = fs.readFileSync(playlist, 'utf8');
      this.availableDuration = [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
      if (text.includes('#EXTINF')) {
        if (!this.ready) {
          this.ready = true;
          this.onReady(playlist);
        }
        return;
      }
    } catch {
      // Playlist not created yet.
    }

    if (!this.ready && Date.now() - this.startedAt > 120_000) {
      this.fail('변환 준비 시간이 초과되었습니다. 파일 형식을 확인하세요.');
    }
  }

  handleClose(code) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.cancelled) return;
    if (this.finished) return;

    if (code !== 0) {
      this.finished = true;
      const tail = this.stderr.trim();
      this.onError(tail ? `ffmpeg 변환에 실패했습니다.\n${tail}` : `ffmpeg 변환에 실패했습니다. (종료 코드 ${code})`);
      return;
    }

    this.checkPlaylist();
    if (!this.ready) {
      this.fail('변환된 영상 스트림이 없습니다.');
      return;
    }

    this.finished = true;
    this.onProgress(1);
    this.onFinished();
  }

  fail(message) {
    if (this.cancelled || this.finished) return;
    this.finished = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.process && !this.process.killed) this.process.kill('SIGKILL');
    this.onError(message);
  }

  cancel() {
    this.cancelled = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      child.once('close', resolve);
      try { child.kill('SIGKILL'); } catch { resolve(); }
    });
  }
}

module.exports = { Transcoder, detectEncoder };
