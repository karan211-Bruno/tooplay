package com.tooplay.mobile;

import static org.junit.Assert.*;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.view.*;
import android.widget.*;
import androidx.media3.common.Player;
import androidx.media3.ui.PlayerView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.util.concurrent.atomic.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DeviceSmokeTest {
  File fixture() throws Exception {
    Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
    File file = new File(app.getCacheDir(), "smoke-input.mp4");
    try (InputStream in =
            InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("test.mp4");
        OutputStream out = new FileOutputStream(file)) {
      byte[] bytes = new byte[8192];
      int n;
      while ((n = in.read(bytes)) != -1) out.write(bytes, 0, n);
    }
    return file;
  }

  IntentFilter pickerFilter() throws Exception {
    IntentFilter f = new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);
    f.addCategory(Intent.CATEGORY_OPENABLE);
    f.addDataType("*/*");
    return f;
  }

  View findText(View view, String text) {
    if (view instanceof TextView && text.equals(((TextView) view).getText().toString()))
      return view;
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        View match = findText(group.getChildAt(i), text);
        if (match != null) return match;
      }
    }
    return null;
  }

  PlayerView findPlayer(View view) {
    if (view instanceof PlayerView) return (PlayerView) view;
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        PlayerView match = findPlayer(group.getChildAt(i));
        if (match != null) return match;
      }
    }
    return null;
  }

  void screenshot(String name) throws Exception {
    Thread.sleep(200);
    android.graphics.Bitmap bitmap =
        InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
    File file =
        new File(
            InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), name);
    try (FileOutputStream out = new FileOutputStream(file)) {
      bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
    }
    bitmap.recycle();
  }

  @Test
  public void pickerPlaysSeeksPausesAndSwitchesToRemote() throws Exception {
    File movie = fixture();
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    Instrumentation.ActivityMonitor monitor =
        inst.addMonitor(
            pickerFilter(),
            new Instrumentation.ActivityResult(
                Activity.RESULT_OK, new Intent().setData(Uri.fromFile(movie))),
            true);
    AtomicInteger rendered = new AtomicInteger();
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      scenario.onActivity(
          a -> {
            findPlayer(a.getWindow().getDecorView())
                .getPlayer()
                .addListener(
                    new Player.Listener() {
                      @Override
                      public void onRenderedFirstFrame() {
                        rendered.incrementAndGet();
                      }
                    });
            View open = findText(a.getWindow().getDecorView(), "영상 열기");
            assertNotNull(open);
            open.performClick();
          });
      AtomicBoolean played = new AtomicBoolean();
      long deadline = System.currentTimeMillis() + 20000;
      while (System.currentTimeMillis() < deadline && !played.get()) {
        scenario.onActivity(
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              played.set(
                  p.getPlaybackState() == Player.STATE_READY && p.getCurrentPosition() > 500);
            });
        Thread.sleep(100);
      }
      assertTrue("Real decoder should advance playback", played.get());
      assertTrue("Video renderer should actually render a frame", rendered.get() > 0);
      scenario.onActivity(
          a -> {
            Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
            p.pause();
            p.seekTo(1800);
          });
      Thread.sleep(400);
      scenario.onActivity(
          a -> {
            Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
            assertFalse(p.getPlayWhenReady());
            assertTrue(Math.abs(p.getCurrentPosition() - 1800) < 250);
          });
      inst.removeMonitor(monitor);
      File sub =
          new File(
              InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
              "smoke.srt");
      try (FileOutputStream out = new FileOutputStream(sub)) {
        out.write(
            "1\n00:00:01,000 --> 00:00:03,000\n한국어 자막 테스트\n"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      }
      Instrumentation.ActivityMonitor subMonitor =
          inst.addMonitor(
              pickerFilter(),
              new Instrumentation.ActivityResult(
                  Activity.RESULT_OK, new Intent().setData(Uri.fromFile(sub))),
              true);
      scenario.onActivity(a -> findText(a.getWindow().getDecorView(), "자막 열기").performClick());
      AtomicBoolean subtitled = new AtomicBoolean();
      deadline = System.currentTimeMillis() + 10000;
      while (System.currentTimeMillis() < deadline && !subtitled.get()) {
        scenario.onActivity(
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              for (androidx.media3.common.text.Cue cue : p.getCurrentCues().cues)
                if (cue.text != null && cue.text.toString().contains("한국어 자막 테스트"))
                  subtitled.set(true);
            });
        Thread.sleep(100);
      }
      inst.removeMonitor(subMonitor);
      sub.delete();
      AtomicReference<String> subtitleState = new AtomicReference<>("");
      if (!subtitled.get()) {
        scenario.onActivity(
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              StringBuilder state =
                  new StringBuilder("position=")
                      .append(p.getCurrentPosition())
                      .append(", state=")
                      .append(p.getPlaybackState())
                      .append(", playWhenReady=")
                      .append(p.getPlayWhenReady())
                      .append(", cues=");
              for (androidx.media3.common.text.Cue cue : p.getCurrentCues().cues)
                state.append(cue.text).append("; ");
              androidx.media3.common.MediaItem item = p.getCurrentMediaItem();
              state
                  .append(", subtitleConfigs=")
                  .append(
                      item == null || item.localConfiguration == null
                          ? -1
                          : item.localConfiguration.subtitleConfigurations.size());
              if (item != null && item.localConfiguration != null) {
                for (androidx.media3.common.MediaItem.SubtitleConfiguration config :
                    item.localConfiguration.subtitleConfigurations)
                  state
                      .append(" [")
                      .append(config.uri)
                      .append(", ")
                      .append(config.mimeType)
                      .append(", flags=")
                      .append(config.selectionFlags)
                      .append("]");
              }
              state.append(", textTracks=");
              for (androidx.media3.common.Tracks.Group group : p.getCurrentTracks().getGroups()) {
                if (group.getType() != androidx.media3.common.C.TRACK_TYPE_TEXT) continue;
                for (int i = 0; i < group.length; i++)
                  state
                      .append(" [")
                      .append(group.getTrackFormat(i).sampleMimeType)
                      .append(", selected=")
                      .append(group.isTrackSelected(i))
                      .append("]");
              }
              state.append(", UI=");
              appendVisibleText(a.getWindow().getDecorView(), state);
              subtitleState.set(state.toString());
            });
      }
      assertTrue(
          "Actual rendered cue should retain Korean: " + subtitleState.get(), subtitled.get());
      scenario.onActivity(a -> findPlayer(a.getWindow().getDecorView()).setUseController(false));
      Thread.sleep(1000);
      screenshot("local-playback.png");
      scenario.onActivity(
          a -> {
            findText(a.getWindow().getDecorView(), "컴퓨터 연결").performClick();
            assertNotNull(findText(a.getWindow().getDecorView(), "컴퓨터의 Tooplay 연결"));
          });
    } finally {
      inst.removeMonitor(monitor);
      movie.delete();
    }
  }

  private static void appendVisibleText(View view, StringBuilder out) {
    if (!view.isShown()) return;
    if (view instanceof TextView) out.append(((TextView) view).getText()).append(" | ");
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) appendVisibleText(group.getChildAt(i), out);
    }
  }

  @Test
  public void castServerServesRangesAndRejectsUnknownPaths() throws Exception {
    File movie = fixture();
    LocalMediaServer server = new LocalMediaServer(movie, null);
    server.start();
    try {
      URL url = new URL(server.videoURL());
      HttpURLConnection c = (HttpURLConnection) url.openConnection();
      c.setRequestProperty("Range", "bytes=1-20");
      assertEquals(206, c.getResponseCode());
      assertEquals("bytes 1-20/" + movie.length(), c.getHeaderField("Content-Range"));
      assertEquals(20, c.getInputStream().readAllBytes().length);
      c.disconnect();
      c =
          (HttpURLConnection)
              new URL("http://" + url.getHost() + ":" + url.getPort() + "/video.mp4")
                  .openConnection();
      assertEquals(404, c.getResponseCode());
      c.disconnect();
      c = (HttpURLConnection) url.openConnection();
      c.setRequestProperty("Range", "bytes=" + movie.length() + "-");
      assertEquals(416, c.getResponseCode());
      c.disconnect();
    } finally {
      server.stop();
      movie.delete();
    }
  }

  @Test
  public void productionCastPreparationExports720p30() throws Exception {
    File movie = fixture();
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    Instrumentation.ActivityMonitor monitor =
        inst.addMonitor(
            pickerFilter(),
            new Instrumentation.ActivityResult(
                Activity.RESULT_OK, new Intent().setData(Uri.fromFile(movie))),
            true);
    AtomicReference<File> exported = new AtomicReference<>();
    AtomicReference<String> status = new AtomicReference<>("");
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      scenario.onActivity(a -> findText(a.getWindow().getDecorView(), "영상 열기").performClick());
      Thread.sleep(500);
      scenario.onActivity(
          a -> {
            try {
              java.lang.reflect.Method prepare =
                  MainActivity.class.getDeclaredMethod("prepareCast");
              prepare.setAccessible(true);
              prepare.invoke(a);
            } catch (Exception e) {
              throw new AssertionError(e);
            }
          });
      long deadline = System.currentTimeMillis() + 60000;
      while (System.currentTimeMillis() < deadline && exported.get() == null) {
        scenario.onActivity(
            a -> {
              try {
                java.lang.reflect.Field f = MainActivity.class.getDeclaredField("exportedFile");
                f.setAccessible(true);
                exported.set((File) f.get(a));
                f = MainActivity.class.getDeclaredField("localStatus");
                f.setAccessible(true);
                status.set(((TextView) f.get(a)).getText().toString());
              } catch (Exception e) {
                throw new AssertionError(e);
              }
            });
        Thread.sleep(200);
      }
      assertNotNull("Production export must complete: " + status.get(), exported.get());
      android.media.MediaMetadataRetriever probe = new android.media.MediaMetadataRetriever();
      probe.setDataSource(exported.get().getAbsolutePath());
      assertEquals(
          "1280",
          probe.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
      assertEquals(
          "720",
          probe.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
      int frames =
          Integer.parseInt(
              probe.extractMetadata(
                  android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT));
      assertTrue(
          "60fps source should be reduced to about120 frames, got " + frames,
          frames >= 115 && frames <= 125);
      probe.release();
      try (InputStream in = new FileInputStream(exported.get());
          OutputStream out =
              new FileOutputStream(
                  new File(inst.getTargetContext().getFilesDir(), "verified-cast.mp4"))) {
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) != -1) out.write(b, 0, n);
      }
    } finally {
      inst.removeMonitor(monitor);
      movie.delete();
    }
  }
}
