package com.tooplay.mobile;

import fi.iki.elonen.NanoHTTPD;
import java.io.*;
import java.net.*;
import java.security.SecureRandom;
import java.util.*;

final class LocalMediaServer extends NanoHTTPD {
  private final File video, subtitles;
  private final String path;

  LocalMediaServer(File video, File subtitles) {
    super(0);
    this.video = video;
    this.subtitles = subtitles;
    byte[] bytes = new byte[24];
    new SecureRandom().nextBytes(bytes);
    StringBuilder key = new StringBuilder();
    for (byte b : bytes) key.append(String.format(Locale.US, "%02x", b & 255));
    path = "/" + key + "/";
  }

  String videoURL() throws IOException {
    return baseURL() + "video.mp4";
  }

  String subtitleURL() throws IOException {
    return baseURL() + "subtitles.vtt";
  }

  private String baseURL() throws IOException {
    List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
    interfaces.sort(Comparator.comparing(i -> i.getName().startsWith("wlan") ? 0 : 1));
    for (NetworkInterface i : interfaces) {
      if (!i.isUp() || i.isLoopback() || i.getName().startsWith("tun")) continue;
      for (InetAddress a : Collections.list(i.getInetAddresses()))
        if (a instanceof Inet4Address && a.isSiteLocalAddress())
          return "http://" + a.getHostAddress() + ":" + getListeningPort() + path;
    }
    throw new IOException("TV와 같은 Wi-Fi에 연결하세요.");
  }

  @Override
  public Response serve(IHTTPSession request) {
    if (request.getMethod() == Method.OPTIONS)
      return headers(newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", ""));
    if (request.getMethod() != Method.GET && request.getMethod() != Method.HEAD)
      return headers(newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", ""));
    File file;
    String mime;
    if (request.getUri().equals(path + "video.mp4")) {
      file = video;
      mime = "video/mp4";
    } else if (request.getUri().equals(path + "subtitles.vtt") && subtitles != null) {
      file = subtitles;
      mime = "text/vtt; charset=utf-8";
    } else return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "");
    long size = file.length();
    try {
      ByteRange range = ByteRange.parse(request.getHeaders().get("range"), size);
      FileInputStream stream = new FileInputStream(file);
      stream.getChannel().position(range.start);
      Response response =
          newFixedLengthResponse(
              range.partial ? Response.Status.PARTIAL_CONTENT : Response.Status.OK,
              mime,
              stream,
              range.length());
      response.addHeader("Accept-Ranges", "bytes");
      if (range.partial)
        response.addHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + size);
      return headers(response);
    } catch (IllegalArgumentException e) {
      Response response = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, mime, "");
      response.addHeader("Content-Range", "bytes */" + size);
      return headers(response);
    } catch (IOException e) {
      return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "");
    }
  }

  private Response headers(Response r) {
    r.addHeader("Access-Control-Allow-Origin", "*");
    r.addHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    r.addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    r.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    r.addHeader("Cache-Control", "no-store");
    return r;
  }
}
