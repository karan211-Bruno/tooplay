const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const iconv = require('iconv-lite');
const { parseSubtitleText, decodeText, writeVTT, preferredTrack, displayName } = require('../src/main/subtitles');

test('Korean SRT, WebVTT cue settings, ASS commas and SAMI line breaks', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,000\r\n<b>안녕하세요</b>\r\n둘째 줄\r\n';
  assert.deepEqual(parseSubtitleText(srt,'.srt'), [{start:1,end:3,text:'안녕하세요\n둘째 줄'}]);
  assert.equal(parseSubtitleText('WEBVTT\n\n00:01.000 --> 00:03.000 align:center\n자막','.vtt')[0].text,'자막');
  assert.equal(parseSubtitleText('Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,첫째, 쉼표\\N둘째','.ass')[0].text, '첫째, 쉼표\n둘째');
  assert.equal(parseSubtitleText('<html><SYNC Start=1000><P>첫째<br>둘째<SYNC Start=3000><P>&nbsp;</body>','.smi')[0].text, '첫째\n둘째');
});

test('UTF-8, UTF-16 and EUC-KR remain readable', () => {
  for (const encoding of ['utf8','utf16le','utf16be','euc-kr']) {
    const body = iconv.encode('한국어 자막', encoding, { addBOM: encoding.startsWith('utf16') });
    assert.equal(decodeText(body), '한국어 자막');
  }
});

test('VTT timestamp rounding carries into seconds and escapes literal tags', (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tooplay-vtt-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'sub.vtt'); writeVTT([{start:59.9999,end:61,text:'<안녕> & 안녕'}],file);
  const output=fs.readFileSync(file,'utf8'); assert.match(output,/00:01:00.000 --> 00:01:01.000/);
  assert.match(output,/&lt;안녕&gt; &amp; 안녕/);
  assert.equal(parseSubtitleText(output,'.vtt')[0].text,'<안녕> & 안녕');
});

test('Korean preference and unknown language labels', () => {
  assert.equal(preferredTrack([{id:'en',language:'en'},{id:'ko',language:'kor'}]).id,'ko');
  assert.equal(displayName('und','내장 자막 1'),'내장 자막 1');
});
