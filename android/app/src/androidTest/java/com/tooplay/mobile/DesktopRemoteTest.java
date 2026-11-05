package com.tooplay.mobile;

import static org.junit.Assert.*;

import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DesktopRemoteTest {
  private View lastText(View v, String text) {
    View found =
        v instanceof TextView && text.equals(((TextView) v).getText().toString()) ? v : null;
    if (v instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) v;
      for (int i = 0; i < g.getChildCount(); i++) {
        View match = lastText(g.getChildAt(i), text);
        if (match != null) found = match;
      }
    }
    return found;
  }

  private EditText input(View v, String hint) {
    if (v instanceof EditText && hint.equals(((EditText) v).getHint().toString()))
      return (EditText) v;
    if (v instanceof ViewGroup) {
      ViewGroup g = (ViewGroup) v;
      for (int i = 0; i < g.getChildCount(); i++) {
        EditText match = input(g.getChildAt(i), hint);
        if (match != null) return match;
      }
    }
    return null;
  }

  private Object field(MainActivity activity, String name) {
    try {
      Field f = MainActivity.class.getDeclaredField(name);
      f.setAccessible(true);
      return f.get(activity);
    } catch (Exception e) {
      throw new AssertionError(e);
    }
  }

  @Test
  public void pairAndControlActualDesktop() throws Exception {
    Bundle args = InstrumentationRegistry.getArguments();
    String address = args.getString("desktopAddress"), code = args.getString("desktopCode");
    Assume.assumeTrue(
        "Supply an isolated desktop fixture to run this integration test",
        address != null && code != null);
    AtomicReference<RemoteClient> client = new AtomicReference<>();
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      scenario.onActivity(
          a -> {
            ((Button) field(a, "remoteTab")).performClick();
            input(a.getWindow().getDecorView(), "192.168.1.20:43123").setText(address);
            input(a.getWindow().getDecorView(), "연결 코드 6자리").setText(code);
            ((Button) field(a, "pairButton")).performClick();
            client.set((RemoteClient) field(a, "remote"));
          });
      long end = System.currentTimeMillis() + 15000;
      while (!client.get().paired() && System.currentTimeMillis() < end) Thread.sleep(100);
      assertTrue("Pairing from real app should succeed", client.get().paired());
      Thread.sleep(600);
      JSONObject state = client.get().state();
      assertTrue(state.optBoolean("hasMedia"));
      assertFalse(state.optBoolean("playing"));
      scenario.onActivity(a -> ((Button) field(a, "remotePlay")).performClick());
      end = System.currentTimeMillis() + 6000;
      while (!(state = client.get().state()).optBoolean("playing")
          && System.currentTimeMillis() < end) Thread.sleep(100);
      assertTrue("Desktop should start playing", state.optBoolean("playing"));
      Thread.sleep(1200);
      scenario.onActivity(a -> ((Button) field(a, "remotePlay")).performClick());
      end = System.currentTimeMillis() + 6000;
      while ((state = client.get().state()).optBoolean("playing")
          && System.currentTimeMillis() < end) Thread.sleep(100);
      assertFalse("Desktop should pause", state.optBoolean("playing"));
      Thread.sleep(300);
      android.graphics.Bitmap bitmap =
          InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
      try (java.io.FileOutputStream out =
          new java.io.FileOutputStream(
              new java.io.File(
                  InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),
                  "desktop-remote.png"))) {
        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
      }
      bitmap.recycle();
      scenario.onActivity(a -> lastText(a.getWindow().getDecorView(), "+10초").performClick());
      Thread.sleep(1200);
      state = client.get().state();
      assertTrue(
          "Seek should reach the last part of a 12-second fixture",
          state.optDouble("currentTime") >= 9);
      assertTrue(
          "Korean desktop subtitle list should be available",
          state.optJSONArray("subtitles") != null && state.optJSONArray("subtitles").length() > 0);
      scenario.onActivity(a -> ((Button) field(a, "disconnect")).performClick());
      end = System.currentTimeMillis() + 5000;
      while (client.get().paired() && System.currentTimeMillis() < end) Thread.sleep(100);
      assertFalse(client.get().paired());
    }
  }
}
