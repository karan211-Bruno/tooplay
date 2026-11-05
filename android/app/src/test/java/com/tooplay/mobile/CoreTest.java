package com.tooplay.mobile;

import static org.junit.Assert.*;

import java.nio.charset.*;
import org.junit.Test;

public class CoreTest {
  @Test
  public void rangesSupportCastRequests() {
    ByteRange r = ByteRange.parse("bytes=2-5", 10);
    assertEquals(2, r.start);
    assertEquals(5, r.end);
    assertEquals(4, r.length());
    assertTrue(r.partial);
    r = ByteRange.parse("bytes=-4", 10);
    assertEquals(6, r.start);
    assertEquals(9, r.end);
    r = ByteRange.parse("bytes=8-", 10);
    assertEquals(2, r.length());
    r = ByteRange.parse("bytes=0-100", 10);
    assertEquals(10, r.length());
    assertFalse(ByteRange.parse(null, 10).partial);
  }

  @Test
  public void rejectInvalidRanges() {
    for (String range :
        new String[] {
          "bytes=10-",
          "bytes=5-2",
          "bytes=0-1,4-5",
          "bytes=-0",
          "bytes=-",
          "items=0-1",
          "bytes=9999999999999999999999-"
        }) {
      try {
        ByteRange.parse(range, 10);
        fail(range);
      } catch (IllegalArgumentException expected) {
      }
    }
  }

  @Test
  public void srtKeepsKoreanAndTiming() {
    String input = "1\r\n00:00:01,234 --> 00:00:04,567\r\n안녕하세요\r\n";
    String out = SubtitleCodec.toVtt(input.getBytes(StandardCharsets.UTF_8));
    assertTrue(out.startsWith("WEBVTT\n\n"));
    assertTrue(out.contains("00:00:01.234 --> 00:00:04.567"));
    assertTrue(out.contains("안녕하세요"));
  }

  @Test
  public void eucKrAndVttAreAccepted() {
    String input = "WEBVTT\n\n00:01.000 --> 00:02.000\n자막";
    String out = SubtitleCodec.toVtt(input.getBytes(Charset.forName("EUC-KR")));
    assertEquals(1, out.split("WEBVTT", -1).length - 1);
    assertTrue(out.contains("자막"));
  }

  @Test(expected = IllegalArgumentException.class)
  public void rejectWrongSubtitles() {
    SubtitleCodec.toVtt("plain text".getBytes(StandardCharsets.UTF_8));
  }

  @Test
  public void remoteOnlyUsesPrivateNumericAddresses() {
    assertEquals("http://192.168.1.3:45123", RemoteClient.validateAddress("192.168.1.3:45123"));
    assertEquals("http://10.0.0.4:12", RemoteClient.validateAddress("http://10.0.0.4:12/"));
    for (String address :
        new String[] {
          "example.com:80",
          "8.8.8.8:80",
          "127.0.0.1:80",
          "http://192.168.1.1:80/api",
          "https://192.168.1.1:80",
          "192.168.1.1",
          "192.168.999.1:80",
          "http://user@192.168.1.1:80"
        }) {
      try {
        RemoteClient.validateAddress(address);
        fail(address);
      } catch (IllegalArgumentException expected) {
      }
    }
  }
}
