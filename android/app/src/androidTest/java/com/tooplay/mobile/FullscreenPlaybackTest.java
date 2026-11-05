package com.tooplay.mobile;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.net.Uri;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.widget.TextView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.text.Cue;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Exercises the real decoder and Activity layout; only the system file-picker result is supplied.
 */
@RunWith(AndroidJUnit4.class)
public class FullscreenPlaybackTest {
  private static final String CAPTION = "전체화면에서도 유지되는 한국어 자막";
  private static final long POSITION_MS = 1800;

  private interface UiCondition {
    boolean matches(MainActivity activity);
  }

  private static final class PlaybackSnapshot {
    final MainActivity activity;
    final PlayerView view;
    final Player player;
    final MediaItem item;
    final ViewParent inlineParent;
    final long position;
    final boolean statusVisible;
    final boolean navigationVisible;

    PlaybackSnapshot(MainActivity activity) {
      this.activity = activity;
      view = findPlayer(activity.getWindow().getDecorView());
      player = view.getPlayer();
      item = player.getCurrentMediaItem();
      inlineParent = view.getParent();
      position = player.getCurrentPosition();
      WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
      assertNotNull("Inline window must have insets before the transition", insets);
      statusVisible = insets.isVisible(WindowInsetsCompat.Type.statusBars());
      navigationVisible = insets.isVisible(WindowInsetsCompat.Type.navigationBars());
    }
  }

  @Test
  public void fullscreenFitFillRotationAndExitPreserveActualPlaybackAndSubtitle() throws Exception {
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    Context app = inst.getTargetContext();
    File movie = copyFixture(app);
    File subtitle = new File(app.getCacheDir(), "fullscreen-input.srt");
    try (OutputStream out = new FileOutputStream(subtitle)) {
      out.write(
          ("1\n00:00:00,000 --> 00:00:04,000\n" + CAPTION + "\n").getBytes(StandardCharsets.UTF_8));
    }
    // Activity.getPreferences uses the Activity's simple class name. Restore this one setting only.
    SharedPreferences preferences = app.getSharedPreferences("MainActivity", Context.MODE_PRIVATE);
    boolean hadFill = preferences.contains("displayFill");
    boolean oldFill = preferences.getBoolean("displayFill", false);
    AtomicInteger renderedFrames = new AtomicInteger();
    AtomicReference<PlaybackSnapshot> baseline = new AtomicReference<>();
    AtomicInteger originalOrientation =
        new AtomicInteger(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      try {
        scenario.onActivity(
            a -> {
              originalOrientation.set(a.getRequestedOrientation());
              a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
              findPlayer(a.getWindow().getDecorView())
                  .getPlayer()
                  .addListener(
                      new Player.Listener() {
                        @Override
                        public void onRenderedFirstFrame() {
                          renderedFrames.incrementAndGet();
                        }
                      });
            });
        await(
            scenario,
            "Portrait Activity must finish layout",
            a ->
                a.getResources().getConfiguration().orientation
                        == Configuration.ORIENTATION_PORTRAIT
                    && a.getWindow().getDecorView().getHeight()
                        > a.getWindow().getDecorView().getWidth());
        chooseFile(scenario, movie, "영상 열기");
        await(
            scenario,
            "Real video decoder must render and advance",
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              return p.getPlaybackState() == Player.STATE_READY
                  && p.getCurrentPosition() > 300
                  && renderedFrames.get() > 0;
            });
        scenario.onActivity(
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              p.pause();
              p.seekTo(POSITION_MS);
            });
        await(
            scenario,
            "Seek must settle before adding the subtitle",
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              return p.getPlaybackState() == Player.STATE_READY
                  && Math.abs(p.getCurrentPosition() - POSITION_MS) < 100;
            });
        chooseFile(scenario, subtitle, "자막 열기");
        await(
            scenario,
            "Selected Korean subtitle must become an active decoder cue",
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              return p.getPlaybackState() == Player.STATE_READY
                  && hasCaption(p)
                  && !p.getPlayWhenReady();
            });
        scenario.onActivity(
            a -> {
              clickVisible(a, "원본 비율");
              baseline.set(new PlaybackSnapshot(a));
              clickVisible(a, "전체화면");
            });

        await(
            scenario,
            "Fullscreen must reparent the existing player and hide both system bars",
            a ->
                findPlayer(a.getWindow().getDecorView()).getParent() != baseline.get().inlineParent
                    && systemBarsHidden(a));
        awaitGeometry(scenario, AspectRatioFrameLayout.RESIZE_MODE_FIT);
        scenario.onActivity(a -> assertPreserved(a, baseline.get()));
        screenshot("fullscreen-portrait-fit.png");

        scenario.onActivity(a -> clickVisible(a, "화면 채우기"));
        awaitGeometry(scenario, AspectRatioFrameLayout.RESIZE_MODE_ZOOM);
        scenario.onActivity(a -> assertPreserved(a, baseline.get()));
        screenshot("fullscreen-portrait-fill.png");

        scenario.onActivity(
            a -> a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
        await(
            scenario,
            "Fullscreen must follow landscape rotation",
            a ->
                a.getResources().getConfiguration().orientation
                        == Configuration.ORIENTATION_LANDSCAPE
                    && findPlayer(a.getWindow().getDecorView()).getWidth()
                        > findPlayer(a.getWindow().getDecorView()).getHeight());
        awaitGeometry(scenario, AspectRatioFrameLayout.RESIZE_MODE_ZOOM);
        scenario.onActivity(a -> assertPreserved(a, baseline.get()));
        screenshot("fullscreen-landscape-fill.png");

        scenario.onActivity(a -> clickVisible(a, "원본 비율"));
        awaitGeometry(scenario, AspectRatioFrameLayout.RESIZE_MODE_FIT);
        scenario.onActivity(a -> assertPreserved(a, baseline.get()));
        screenshot("fullscreen-landscape-fit.png");

        scenario.onActivity(
            a -> a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
        await(
            scenario,
            "Fullscreen must return to portrait without recreating playback",
            a ->
                a.getResources().getConfiguration().orientation
                        == Configuration.ORIENTATION_PORTRAIT
                    && findPlayer(a.getWindow().getDecorView()).getHeight()
                        > findPlayer(a.getWindow().getDecorView()).getWidth());
        awaitGeometry(scenario, AspectRatioFrameLayout.RESIZE_MODE_FIT);
        // Route a real Android Back key through the focused Activity, not a private app method.
        await(
            scenario,
            "Rotated Activity must regain window focus before receiving Back",
            Activity::hasWindowFocus);
        inst.waitForIdleSync();
        inst.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
        awaitInline(scenario, baseline.get());
        scenario.onActivity(a -> assertPreserved(a, baseline.get()));

        // Cover explicit close too, with fill active, so neither exit path can reset the
        // preference.
        scenario.onActivity(
            a -> {
              clickVisible(a, "전체화면");
              clickVisible(a, "화면 채우기");
            });
        awaitGeometry(scenario, AspectRatioFrameLayout.RESIZE_MODE_ZOOM);
        scenario.onActivity(a -> clickVisible(a, "전체화면 닫기"));
        awaitInline(scenario, baseline.get());
        scenario.onActivity(
            a -> {
              assertPreserved(a, baseline.get());
              assertEquals(
                  AspectRatioFrameLayout.RESIZE_MODE_ZOOM, baseline.get().view.getResizeMode());
            });
        tapPlayPause(scenario);
        await(
            scenario,
            "A real touch must reach Play through the subtitle overlay and resume the same decoder",
            a -> {
              Player p = findPlayer(a.getWindow().getDecorView()).getPlayer();
              return p.isPlaying() && p.getCurrentPosition() > baseline.get().position + 250;
            });
        tapPlayPause(scenario);
        await(
            scenario,
            "A second real touch must reach Pause through the subtitle overlay",
            a -> !findPlayer(a.getWindow().getDecorView()).getPlayer().getPlayWhenReady());
        scenario.onActivity(
            a -> {
              assertSame(
                  baseline.get().player, findPlayer(a.getWindow().getDecorView()).getPlayer());
              assertFalse(baseline.get().player.isPlaying());
              assertTrue(
                  "Subtitle remains active after resumed playback",
                  hasCaption(baseline.get().player));
            });
      } finally {
        scenario.onActivity(a -> a.setRequestedOrientation(originalOrientation.get()));
      }
    } finally {
      SharedPreferences.Editor editor = preferences.edit();
      if (hadFill) editor.putBoolean("displayFill", oldFill);
      else editor.remove("displayFill");
      assertTrue("Restore test-owned display preference", editor.commit());
      movie.delete();
      subtitle.delete();
    }
  }

  private static void assertPreserved(MainActivity a, PlaybackSnapshot before) {
    PlayerView view = findPlayer(a.getWindow().getDecorView());
    assertSame("Rotation must retain the Activity", before.activity, a);
    assertSame("Move the existing video view without replacing it", before.view, view);
    assertSame("Fullscreen must retain the decoder/player", before.player, view.getPlayer());
    assertSame(
        "Fullscreen must retain the selected media item",
        before.item,
        view.getPlayer().getCurrentMediaItem());
    assertFalse("A paused movie must stay paused", view.getPlayer().getPlayWhenReady());
    assertEquals(
        "Playback position must not restart or jump",
        before.position,
        view.getPlayer().getCurrentPosition(),
        100);
    assertTrue(
        "Decoded Korean cue must survive fullscreen and rotation", hasCaption(view.getPlayer()));
    SubtitleView subtitles = view.getSubtitleView();
    assertNotNull("Video must retain its subtitle renderer", subtitles);
    assertTrue("Subtitle viewport must remain shown", subtitles.isShown());
    Rect playerBounds = new Rect();
    Rect subtitleBounds = new Rect();
    assertTrue(view.getGlobalVisibleRect(playerBounds));
    assertTrue(subtitles.getGlobalVisibleRect(subtitleBounds));
    assertEquals(
        "Subtitle viewport width must stay within the screen when video is zoomed",
        view.getWidth(),
        subtitles.getWidth());
    assertEquals(
        "Subtitle viewport height must stay within the screen when video is zoomed",
        view.getHeight(),
        subtitles.getHeight());
    assertEquals("The entire subtitle viewport must remain visible", playerBounds, subtitleBounds);
    View surface = view.getVideoSurfaceView();
    assertTrue(
        "Production PlayerView must keep a valid video surface",
        surface instanceof SurfaceView
            && ((SurfaceView) surface).getHolder().getSurface().isValid());
  }

  private static void awaitGeometry(ActivityScenario<MainActivity> scenario, int mode)
      throws Exception {
    await(
        scenario,
        "Rendered video must preserve aspect ratio with resize mode " + mode,
        a -> {
          PlayerView view = findPlayer(a.getWindow().getDecorView());
          View frame = view.findViewById(androidx.media3.ui.R.id.exo_content_frame);
          if (view.getResizeMode() != mode
              || frame == null
              || frame.getHeight() == 0
              || view.getWidth() == 0
              || view.getHeight() == 0) return false;
          double aspect = (double) frame.getWidth() / frame.getHeight();
          if (Math.abs(aspect - 16.0 / 9.0) > 0.04) return false;
          if (mode == AspectRatioFrameLayout.RESIZE_MODE_FIT) {
            return frame.getWidth() <= view.getWidth() + 2
                && frame.getHeight() <= view.getHeight() + 2
                && (frame.getWidth() < view.getWidth() - 10
                    || frame.getHeight() < view.getHeight() - 10);
          }
          return frame.getWidth() >= view.getWidth() - 2
              && frame.getHeight() >= view.getHeight() - 2
              && (frame.getWidth() > view.getWidth() + 10
                  || frame.getHeight() > view.getHeight() + 10);
        });
  }

  private static void awaitInline(ActivityScenario<MainActivity> scenario, PlaybackSnapshot before)
      throws Exception {
    await(
        scenario,
        "Exit must restore inline player and the original system-bar visibility",
        a -> {
          PlayerView view = findPlayer(a.getWindow().getDecorView());
          WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
          return view.getParent() == before.inlineParent
              && view.isShown()
              && findVisible(a.getWindow().getDecorView(), "전체화면") != null
              && insets != null
              && insets.isVisible(WindowInsetsCompat.Type.statusBars()) == before.statusVisible
              && insets.isVisible(WindowInsetsCompat.Type.navigationBars())
                  == before.navigationVisible;
        });
  }

  private static boolean systemBarsHidden(MainActivity a) {
    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(a.getWindow().getDecorView());
    return insets != null
        && !insets.isVisible(WindowInsetsCompat.Type.statusBars())
        && !insets.isVisible(WindowInsetsCompat.Type.navigationBars());
  }

  private static boolean hasCaption(Player player) {
    for (Cue cue : player.getCurrentCues().cues)
      if (cue.text != null && cue.text.toString().contains(CAPTION)) return true;
    return false;
  }

  private static void await(
      ActivityScenario<MainActivity> scenario, String failure, UiCondition condition)
      throws Exception {
    AtomicBoolean matched = new AtomicBoolean();
    long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
    while (!matched.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
      scenario.onActivity(a -> matched.set(condition.matches(a)));
      if (!matched.get()) Thread.sleep(100);
    }
    if (!matched.get()) {
      AtomicReference<String> state = new AtomicReference<>("");
      scenario.onActivity(
          a -> {
            PlayerView view = findPlayer(a.getWindow().getDecorView());
            Player p = view.getPlayer();
            StringBuilder detail =
                new StringBuilder("focus=")
                    .append(a.hasWindowFocus())
                    .append(", state=")
                    .append(p.getPlaybackState())
                    .append(", position=")
                    .append(p.getCurrentPosition())
                    .append(", playWhenReady=")
                    .append(p.getPlayWhenReady())
                    .append(", cues=");
            for (Cue cue : p.getCurrentCues().cues) detail.append(cue.text).append("; ");
            detail.append(", labels=");
            appendVisibleText(a.getWindow().getDecorView(), detail);
            state.set(detail.toString());
          });
      fail(failure + ": " + state.get());
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

  private static void clickVisible(MainActivity a, String label) {
    PlayerView player = findPlayer(a.getWindow().getDecorView());
    if (player != null) player.showController();
    View button = findVisible(a.getWindow().getDecorView(), label);
    assertNotNull("Visible control: " + label, button);
    assertTrue("Enabled control: " + label, button.isEnabled());
    assertTrue("Clickable control: " + label, button.performClick());
  }

  private static void tapPlayPause(ActivityScenario<MainActivity> scenario) throws Exception {
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    scenario.onActivity(a -> findPlayer(a.getWindow().getDecorView()).showController());
    await(
        scenario,
        "Play/pause control must be visible in the focused window",
        a -> {
          View control =
              findPlayer(a.getWindow().getDecorView())
                  .findViewById(androidx.media3.ui.R.id.exo_play_pause);
          Rect visible = new Rect();
          return a.hasWindowFocus()
              && control != null
              && control.isShown()
              && control.isEnabled()
              && control.getGlobalVisibleRect(visible)
              && !visible.isEmpty();
        });
    AtomicReference<float[]> center = new AtomicReference<>();
    scenario.onActivity(
        a -> {
          View control =
              findPlayer(a.getWindow().getDecorView())
                  .findViewById(androidx.media3.ui.R.id.exo_play_pause);
          int[] location = new int[2];
          control.getLocationOnScreen(location);
          center.set(
              new float[] {
                location[0] + control.getWidth() / 2f, location[1] + control.getHeight() / 2f
              });
        });
    long downAt = android.os.SystemClock.uptimeMillis();
    MotionEvent down =
        MotionEvent.obtain(
            downAt, downAt, MotionEvent.ACTION_DOWN, center.get()[0], center.get()[1], 0);
    MotionEvent up =
        MotionEvent.obtain(
            downAt, downAt + 50, MotionEvent.ACTION_UP, center.get()[0], center.get()[1], 0);
    down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    try {
      inst.sendPointerSync(down);
      inst.sendPointerSync(up);
      inst.waitForIdleSync();
    } finally {
      down.recycle();
      up.recycle();
    }
  }

  private static View findVisible(View view, String label) {
    if (!view.isShown()) return null;
    if (label.contentEquals(
            view.getContentDescription() == null ? "" : view.getContentDescription())
        || (view instanceof TextView && label.contentEquals(((TextView) view).getText())))
      return view;
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        View match = findVisible(group.getChildAt(i), label);
        if (match != null) return match;
      }
    }
    return null;
  }

  private static PlayerView findPlayer(View view) {
    if (view instanceof PlayerView) return (PlayerView) view;
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        PlayerView player = findPlayer(group.getChildAt(i));
        if (player != null) return player;
      }
    }
    return null;
  }

  private static void chooseFile(ActivityScenario<MainActivity> scenario, File file, String label)
      throws Exception {
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    IntentFilter filter = new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);
    filter.addCategory(Intent.CATEGORY_OPENABLE);
    filter.addDataType("*/*");
    Instrumentation.ActivityMonitor monitor =
        inst.addMonitor(
            filter,
            new Instrumentation.ActivityResult(
                Activity.RESULT_OK, new Intent().setData(Uri.fromFile(file))),
            true);
    try {
      scenario.onActivity(a -> clickVisible(a, label));
      inst.waitForIdleSync();
      assertEquals(
          "File selection must use the normal Android document-picker flow", 1, monitor.getHits());
    } finally {
      inst.removeMonitor(monitor);
    }
  }

  private static File copyFixture(Context app) throws Exception {
    File movie = new File(app.getCacheDir(), "fullscreen-input.mp4");
    try (InputStream in =
            InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("test.mp4");
        OutputStream out = new FileOutputStream(movie)) {
      byte[] bytes = new byte[8192];
      int count;
      while ((count = in.read(bytes)) != -1) out.write(bytes, 0, count);
    }
    return movie;
  }

  private static void screenshot(String name) throws Exception {
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    // Geometry can settle before the compositor presents the resized video surface.
    Thread.sleep(750);
    inst.waitForIdleSync();
    Bitmap bitmap = inst.getUiAutomation().takeScreenshot();
    assertNotNull("Screenshot is available", bitmap);
    try (FileOutputStream out =
        new FileOutputStream(new File(inst.getTargetContext().getFilesDir(), name))) {
      assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out));
    } finally {
      bitmap.recycle();
    }
  }
}
