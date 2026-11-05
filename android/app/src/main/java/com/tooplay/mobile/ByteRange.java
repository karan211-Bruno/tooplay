package com.tooplay.mobile;

final class ByteRange {
  final long start, end;
  final boolean partial;

  private ByteRange(long start, long end, boolean partial) {
    this.start = start;
    this.end = end;
    this.partial = partial;
  }

  long length() {
    return Math.max(0, end - start + 1);
  }

  static ByteRange parse(String header, long size) {
    if (size < 0) throw new IllegalArgumentException("Invalid size");
    if (header == null || header.isEmpty()) return new ByteRange(0, size - 1, false);
    if (!header.matches("bytes=\\d*-\\d*")) throw new IllegalArgumentException("Invalid range");
    String[] pieces = header.substring(6).split("-", -1);
    try {
      if (size == 0 || (pieces[0].isEmpty() && pieces[1].isEmpty()))
        throw new IllegalArgumentException();
      long start, end;
      if (pieces[0].isEmpty()) {
        long suffix = Long.parseLong(pieces[1]);
        if (suffix <= 0) throw new IllegalArgumentException();
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else {
        start = Long.parseLong(pieces[0]);
        end = pieces[1].isEmpty() ? size - 1 : Math.min(Long.parseLong(pieces[1]), size - 1);
      }
      if (start < 0 || start >= size || end < start) throw new IllegalArgumentException();
      return new ByteRange(start, end, true);
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("Invalid range");
    }
  }
}
