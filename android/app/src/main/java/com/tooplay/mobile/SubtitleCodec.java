package com.tooplay.mobile;

import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.regex.Pattern;

final class SubtitleCodec {
  static final Pattern TIME =
      Pattern.compile(
          "(?m)^(\\d{1,2}:)?\\d{2}:\\d{2}[.,]\\d{3}\\s+-->\\s+(\\d{1,2}:)?\\d{2}:\\d{2}[.,]\\d{3}.*$");

  static String toVtt(byte[] bytes) {
    String text;
    if (bytes.length >= 2
        && ((bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xfe)
            || (bytes[0] == (byte) 0xfe && bytes[1] == (byte) 0xff))) {
      text = new String(bytes, StandardCharsets.UTF_16);
    } else {
      try {
        text =
            StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
      } catch (CharacterCodingException e) {
        text = new String(bytes, Charset.forName("EUC-KR"));
      }
    }
    text = text.replace("\uFEFF", "").replace("\r\n", "\n").replace('\r', '\n').trim();
    if (!TIME.matcher(text).find())
      throw new IllegalArgumentException("시간 정보가 있는 SRT 또는 VTT 자막을 선택하세요.");
    StringBuilder out = new StringBuilder();
    if (!text.startsWith("WEBVTT")) out.append("WEBVTT\n\n");
    for (String line : text.split("\n", -1)) {
      if (TIME.matcher(line).matches())
        line = line.replaceAll("(\\d{2}:\\d{2}),([0-9]{3})", "$1.$2");
      out.append(line).append('\n');
    }
    return out.toString();
  }
}
