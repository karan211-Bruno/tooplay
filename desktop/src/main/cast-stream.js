const fs = require('fs');
const path = require('path');
const { Transcoder, detectEncoder } = require('./transcoder');

function cancelled() {
  const error = new Error('TV 전송 준비가 취소되었습니다.');
  error.code = 'ABORT_ERR';
  return error;
}

// A separate, bounded stream for the TV. Local playback keeps its existing source.
class CastStream {
  constructor({ ffmpeg, input, directory, duration = 0, onProgress = () => {}, onError = () => {}, TranscoderType = Transcoder, encoder = null }) {
    Object.assign(this, { ffmpeg, input, directory, duration, onProgress, onError, TranscoderType, encoder });
    this.current = null;
    this.serial = 0;
  }

  async prepare(position = 0) {
    const serial = ++this.serial;
    await this.cancelCurrent();
    const encoder = this.encoder || await detectEncoder(this.ffmpeg);
    if (serial !== this.serial) throw cancelled();
    const offset = Math.min(Math.max(0, Number(position) || 0), this.duration > 0 ? Math.max(0, this.duration - 0.05) : Infinity);
    const name = `stream-${serial}`;
    const directory = path.join(this.directory, name);
    fs.mkdirSync(directory, { recursive: true });
    const current = { name, directory, offset, ready: false, finished: false, timer: null, reject: null, job: null };
    this.current = current;
    return new Promise((resolve, reject) => {
      current.reject = reject;
      const started = Date.now();
      const active = () => this.current === current && this.serial === serial;
      const fail = (message) => {
        if (!active()) return;
        clearInterval(current.timer);
        reject(new Error(message));
        this.onError(message);
      };
      const check = () => {
        if (!active() || current.ready) return;
        // Eight seconds of complete, published segments; short clips wait for ENDLIST.
        if (current.job.availableDuration >= 8 || (current.finished && current.job.availableDuration > 0)) {
          current.ready = true;
          clearInterval(current.timer);
          current.reject = null;
          resolve(current);
        } else if (Date.now() - started > 120000) {
          fail('TV용 영상 변환이 재생 속도를 따라가지 못합니다. 다른 영상을 시도해 주세요.');
          current.job.cancel();
        }
      };
      current.job = new this.TranscoderType({
        ffmpeg: this.ffmpeg, input: this.input, outputDirectory: directory, encoder,
        purpose: 'cast', startTime: offset,
        onProgress: (progress) => { if (active()) { check(); this.onProgress({ progress, availableDuration: current.job.availableDuration }); } },
        onReady: check,
        onFinished: () => { current.finished = true; check(); },
        onError: fail
      });
      current.job.setDuration(Math.max(0, this.duration - offset));
      current.timer = setInterval(check, 200);
      current.job.start();
    });
  }

  canSeek(position) {
    const current = this.current;
    if (!current || !current.ready) return false;
    const relative = Number(position) - current.offset;
    return relative >= 0 && relative <= current.job.availableDuration - (current.finished ? 0 : 0.5);
  }

  async cancelCurrent() {
    const current = this.current;
    this.current = null;
    if (!current) return;
    clearInterval(current.timer);
    if (current.reject) current.reject(cancelled());
    if (current.job) await current.job.cancel();
  }

  releaseRetired() {
    if (!fs.existsSync(this.directory)) return;
    for (const name of fs.readdirSync(this.directory)) {
      if (!this.current || name !== this.current.name) fs.rmSync(path.join(this.directory, name), { recursive: true, force: true });
    }
  }

  async stop() {
    ++this.serial;
    await this.cancelCurrent();
  }
}
module.exports = { CastStream };
