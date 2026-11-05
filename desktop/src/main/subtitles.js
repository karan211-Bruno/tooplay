const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const iconv = require('iconv-lite');

const SUPPORTED_EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa', 'smi', 'sami']);
const BITMAP_CODECS = new Set([
  'hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'dvb_teletext'
]);

const LANGUAGE_NAMES = {
  ko: '한국어', kor: '한국어',
  en: '영어', eng: '영어',
  ja: '일본어', jpn: '일본어',
  zh: '중국어', chi: '중국어', zho: '중국어',
  es: '스페인어', spa: '스페인어',
  fr: '프랑스어', fra: '프랑스어',
  de: '독일어', deu: '독일어',
  ru: '러시아어', rus: '러시아어'
};

const KNOWN_LANGUAGES = new Set([
  'ko', 'kor', 'en', 'eng', 'ja', 'jpn', 'zh', 'chi', 'zho',
  'es', 'fr', 'de', 'ru', 'pt', 'it'
]);

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 32 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return stripBOM(buffer.toString('utf16le'));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return stripBOM(iconv.decode(buffer, 'utf16be'));
  }

  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) {
    return stripBOM(utf8);
  }

  for (const encoding of ['euc-kr', 'gb18030', 'windows-1252']) {
    const decoded = iconv.decode(buffer, encoding);
    if (!decoded.includes('\uFFFD')) return stripBOM(decoded);
  }

  return stripBOM(utf8);
}

function stripBOM(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitLimit(text, separator, limit) {
  const parts = [];
  let rest = String(text);

  while (parts.length < limit - 1) {
    const index = rest.indexOf(separator);
    if (index < 0) break;
    parts.push(rest.slice(0, index));
    rest = rest.slice(index + separator.length);
  }
  parts.push(rest);
  return parts;
}

function parseTimestamp(value) {
  const cleaned = String(value).trim().replace(',', '.').split(/\s+/)[0];
  const pieces = cleaned.split(':');
  if (pieces.length < 2) return null;

  let seconds = 0;
  for (const piece of pieces) {
    const number = Number(piece);
    if (!Number.isFinite(number)) return null;
    seconds = seconds * 60 + number;
  }
  return seconds;
}

function parseTimestampRange(line, separator = '-->') {
  const parts = String(line).split(separator);
  if (parts.length < 2) return null;
  const start = parseTimestamp(parts[0]);
  const end = parseTimestamp(parts[1]);
  if (start === null || end === null) return null;
  return { start, end: Math.max(start, end) };
}

function cleanMarkup(line) {
  return String(line)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\an\d\}/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\r/g, '')
    .trim();
}

function cleanASS(text) {
  return String(text)
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/\{[^}]*\}/g, '')
    .trim();
}

function parseSRT(text) {
  const blocks = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length < 2) continue;

    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;

    const range = parseTimestampRange(lines[timeIndex]);
    if (!range) continue;

    const content = lines.slice(timeIndex + 1).map(cleanMarkup).filter(Boolean).join('\n');
    if (!content) continue;
    cues.push({ ...range, text: content });
  }

  return cues.sort((a, b) => a.start - b.start);
}

function parseVTT(text) {
  let body = String(text).replace(/\r\n/g, '\n');
  const header = body.indexOf('WEBVTT');
  if (header >= 0) body = body.slice(header + 6);

  const blocks = body.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (!lines.length) continue;

    const first = lines[0].trim();
    if (/^(NOTE|STYLE|REGION)\b/.test(first)) continue;

    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;

    const range = parseTimestampRange(lines[timeIndex]);
    if (!range) continue;

    const content = lines.slice(timeIndex + 1).map(cleanMarkup).filter(Boolean).join('\n');
    if (!content) continue;
    cues.push({ ...range, text: content });
  }

  return cues.sort((a, b) => a.start - b.start);
}

function parseASS(text) {
  let format = [];
  const cues = [];

  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const lower = line.toLowerCase();

    if (lower.startsWith('format:')) {
      format = line.slice(7).split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!lower.startsWith('dialogue:')) continue;

    const payload = line.slice(9).trim();
    const count = format.length || 10;
    const fields = splitLimit(payload, ',', count);

    const startIndex = format.indexOf('start') >= 0 ? format.indexOf('start') : 1;
    const endIndex = format.indexOf('end') >= 0 ? format.indexOf('end') : 2;
    const textIndex = format.indexOf('text') >= 0 ? format.indexOf('text') : count - 1;

    const start = parseTimestamp(fields[startIndex]);
    const end = parseTimestamp(fields[endIndex]);
    if (start === null || end === null) continue;

    const content = cleanASS(fields[textIndex]);
    if (!content) continue;
    cues.push({ start, end: Math.max(start, end), text: content });
  }

  return cues.sort((a, b) => a.start - b.start);
}

function parseSAMI(text) {
  const source = String(text).replace(/\r\n/g, '\n');
  const pattern = /<sync[^>]*start\s*=\s*"?(\d+)"?[^>]*>([\s\S]*?)(?=<sync|<\/body|$)/gi;
  const entries = [];

  let match;
  while ((match = pattern.exec(source)) !== null) {
    const milliseconds = Number(match[1]);
    const content = cleanMarkup(match[2].replace(/<\/?p[^>]*>/gi, ' '));
    entries.push({ time: milliseconds / 1000, text: content });
  }

  entries.sort((a, b) => a.time - b.time);
  const cues = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry.text) continue;

    const next = entries[index + 1];
    const end = next ? next.time : entry.time + 4;
    cues.push({ start: entry.time, end: Math.max(end, entry.time + 0.3), text: entry.text });
  }

  return cues;
}

function parseSubtitleText(text, extension) {
  const trimmed = String(text).trim();
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');

  if (trimmed.startsWith('WEBVTT') || ext === 'vtt') return parseVTT(text);
  if (trimmed.startsWith('[Script Info]') || trimmed.toLowerCase().includes('[events]')
    || ext === 'ass' || ext === 'ssa') {
    return parseASS(text);
  }
  if (trimmed.toLowerCase().startsWith('<sami') || ext === 'smi' || ext === 'sami') {
    return parseSAMI(text);
  }
  return parseSRT(text);
}

function parseSubtitleFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return parseSubtitleText(decodeText(buffer), path.extname(filePath));
}

function findSidecars(videoPath) {
  const directory = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  const folders = [directory];

  const subsFolder = path.join(directory, 'Subs');
  if (fs.existsSync(subsFolder) && fs.statSync(subsFolder).isDirectory()) {
    folders.push(subsFolder);
  }

  const matches = [];
  for (const folder of folders) {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).slice(1).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;

      const name = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      if (name === base || name.startsWith(`${base}.`) || name.startsWith(`${base}_`)) {
        const full = path.join(folder, entry.name);
        if (!matches.includes(full)) matches.push(full);
      }
    }
  }

  return matches.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function languageFromFilename(fileName) {
  const parts = path.basename(fileName).split('.');
  if (parts.length < 3) return '';
  const candidate = parts[parts.length - 2].toLowerCase();
  return KNOWN_LANGUAGES.has(candidate) ? candidate : '';
}

function displayName(language, fallback) {
  const code = String(language || '').toLowerCase().split('-')[0];
  if (!code || code === 'und' || code === 'unknown' || code === 'undetermined') return fallback;
  if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
  return String(language).toUpperCase();
}

function vttTimestamp(seconds) {
  const clamped = Math.max(0, Number(seconds) || 0);
  const totalMilliseconds = Math.round(clamped * 1000);
  const total = Math.floor(totalMilliseconds / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function writeVTT(cues, filePath) {
  let output = 'WEBVTT\n\n';
  for (const cue of cues) {
    if (!cue.text) continue;
    output += `${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}\n${cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n\n`;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, output, 'utf8');
}

function normalizeLanguage(language) {
  const code = String(language || '').trim().toLowerCase();
  if (!code || code === 'und' || code === 'unknown' || code === 'undetermined') return '';
  return code;
}

async function probeEmbedded(videoPath, ffprobe, signal) {
  if (!ffprobe) return [];

  try {
    const { stdout } = await run(ffprobe, [
      '-v', 'error',
      '-select_streams', 's',
      '-show_entries', 'stream=index,codec_name:stream_tags=language,title',
      '-of', 'json',
      videoPath
    ], { signal, timeout: 30000, windowsHide: true });

    const parsed = JSON.parse(stdout);
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];

    return streams
      .filter((stream) => Number.isInteger(stream.index))
      .filter((stream) => !BITMAP_CODECS.has(stream.codec_name || ''))
      .map((stream) => ({
        index: stream.index,
        codec: stream.codec_name || '',
        language: normalizeLanguage((stream.tags && stream.tags.language) || ''),
        title: (stream.tags && stream.tags.title) || ''
      }));
  } catch {
    return [];
  }
}

async function extractEmbedded(videoPath, streamIndex, ffmpeg, outputPath, signal) {
  if (!ffmpeg) throw new Error('ffmpeg not found');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await run(ffmpeg, [
    '-hide_banner', '-v', 'error', '-nostdin', '-y',
    '-i', videoPath,
    '-map', `0:${streamIndex}`,
    '-c:s', 'webvtt',
    outputPath
  ], { signal, timeout: 120000, windowsHide: true });

  if (!fs.existsSync(outputPath)) throw new Error('Subtitle extraction failed');
}

async function prepareSubtitles({ videoPath, subsDirectory, ffmpeg, ffprobe, signal }) {
  const tracks = [];
  const sidecars = findSidecars(videoPath);

  sidecars.forEach((sidecar, index) => {
    try {
      const cues = parseSubtitleFile(sidecar);
      if (!cues.length) return;

      const language = languageFromFilename(sidecar);
      const vttPath = path.join(subsDirectory, `external-${index}.vtt`);
      writeVTT(cues, vttPath);

      tracks.push({
        id: `external-${index}-${path.basename(sidecar)}`,
        name: displayName(language, path.basename(sidecar, path.extname(sidecar))),
        language,
        origin: 'external',
        cues,
        vttPath
      });
    } catch {
      // Ignore unreadable sidecar files.
    }
  });

  const embedded = await probeEmbedded(videoPath, ffprobe, signal);

  for (const [index, stream] of embedded.entries()) {
    if (signal && signal.aborted) break;
    const vttPath = path.join(subsDirectory, `embedded-${stream.index}.vtt`);
    try {
      await extractEmbedded(videoPath, stream.index, ffmpeg, vttPath, signal);
      const cues = parseSubtitleFile(vttPath);
      if (!cues.length) continue;

      let label = `내장 자막 ${index + 1}`;
      if (stream.title) label = `내장 · ${stream.title}`;
      else if (stream.language) label = `내장 · ${displayName(stream.language, label)}`;

      tracks.push({
        id: `embedded-${stream.index}`,
        name: label,
        language: stream.language,
        origin: 'embedded',
        cues,
        vttPath
      });
    } catch {
      // Bitmap or unsupported subtitle streams are skipped.
    }
  }

  return tracks;
}

function preferredTrack(tracks) {
  if (!tracks.length) return null;
  const korean = tracks.find((track) => ['ko', 'kor'].includes(String(track.language).toLowerCase()));
  return korean || tracks[0];
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  parseSubtitleText,
  parseSubtitleFile,
  findSidecars,
  languageFromFilename,
  displayName,
  writeVTT,
  probeEmbedded,
  prepareSubtitles,
  preferredTrack,
  decodeText
};
