package com.tooplay.mobile;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

final class RemoteClient {
  private String base = "", token = "";

  boolean paired() {
    return !token.isEmpty();
  }

  String address() {
    return base;
  }

  static String validateAddress(String address) {
    address = address.trim();
    if (!address.startsWith("http://")) address = "http://" + address;
    try {
      URI uri = new URI(address);
      String host = uri.getHost();
      if (!"http".equals(uri.getScheme())
          || host == null
          || !host.matches("\\d{1,3}(\\.\\d{1,3}){3}")
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) throw new Exception();
      String[] octets = host.split("\\.");
      int[] n = new int[4];
      for (int i = 0; i < 4; i++) {
        n[i] = Integer.parseInt(octets[i]);
        if (n[i] > 255) throw new Exception();
      }
      if (!(n[0] == 10
          || (n[0] == 192 && n[1] == 168)
          || (n[0] == 172 && n[1] >= 16 && n[1] <= 31))) throw new Exception();
      int port = uri.getPort();
      if (port < 1 || port > 65535) throw new Exception();
      return "http://" + host + ":" + port;
    } catch (Exception e) {
      throw new IllegalArgumentException("컴퓨터에 표시된 Wi-Fi 주소와 포트를 입력하세요. 예: 192.168.1.20:43123");
    }
  }

  JSONObject pair(String address, String code) throws Exception {
    base = validateAddress(address);
    token = "";
    if (!code.matches("[0-9]{6}")) throw new IllegalArgumentException("연결 코드 6자리를 입력하세요.");
    JSONObject result =
        request(
            "POST", "/api/pair", new JSONObject().put("code", code).put("name", "Tooplay Android"));
    token = result.getString("token");
    return result;
  }

  JSONObject state() throws Exception {
    return request("GET", "/api/state", null);
  }

  void command(JSONObject command) throws Exception {
    request("POST", "/api/command", command);
  }

  void disconnect() {
    try {
      if (paired()) request("DELETE", "/api/session", null);
    } catch (Exception ignored) {
    } finally {
      token = "";
    }
  }

  void forget() {
    token = "";
  }

  private JSONObject request(String method, String route, JSONObject body) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(base + route).openConnection();
    connection.setInstanceFollowRedirects(false);
    connection.setConnectTimeout(5000);
    connection.setReadTimeout(10000);
    connection.setRequestMethod(method);
    connection.setRequestProperty("Accept", "application/json");
    if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
    try {
      if (body != null) {
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = connection.getOutputStream()) {
          out.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
      }
      int status = connection.getResponseCode();
      InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream();
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      if (input != null)
        try (InputStream in = input) {
          byte[] chunk = new byte[4096];
          int count;
          while ((count = in.read(chunk)) != -1) {
            if (bytes.size() + count > 262144) throw new IOException("응답이 너무 큽니다.");
            bytes.write(chunk, 0, count);
          }
        }
      JSONObject result =
          bytes.size() > 0 ? new JSONObject(bytes.toString("UTF-8")) : new JSONObject();
      if (status < 200 || status >= 300) {
        if (status == 401) token = "";
        throw new IOException(result.optString("error", "연결 실패 (" + status + ")"));
      }
      return result;
    } finally {
      connection.disconnect();
    }
  }
}
