const { execFile } = require('child_process');

function probeMedia(file, ffprobe, signal) {
  if (!ffprobe) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    execFile(ffprobe, ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,codec_name,pix_fmt', '-of', 'json', file],
    { signal, timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new Error(`영상 정보를 읽을 수 없습니다: ${error.message}`));
      try {
        const result = JSON.parse(stdout);
        if (!(result.streams || []).some((stream) => stream.codec_type === 'video')) {
          throw new Error('영상 트랙이 없는 파일입니다.');
        }
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

function canPlayDirect(extension, info) {
  if (!['mp4', 'm4v', 'mov'].includes(extension)) return false;
  if (!info) return true;
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');
  return video && video.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(video.pix_fmt)
    && (!audio || ['aac', 'mp3'].includes(audio.codec_name));
}

module.exports = { probeMedia, canPlayDirect };
