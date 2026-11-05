package com.tooplay.mobile;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.*;
import androidx.media3.effect.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.transformer.*;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.mediarouter.app.MediaRouteButton;
import com.google.android.gms.cast.*;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.*;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class MainActivity extends AppCompatActivity {
  private static final int VIDEO_REQUEST = 11, SUB_REQUEST = 12;
  private static final int BG = Color.rgb(16, 19, 25),
      PANEL = Color.rgb(28, 33, 42),
      INK = Color.rgb(239, 244, 245),
      MUTED = Color.rgb(167, 180, 191),
      ACCENT = Color.rgb(132, 224, 193);
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final RemoteClient remote = new RemoteClient();
  private LinearLayout localPage, remotePage, remoteControls, root;
  private TextView localTitle,
      localStatus,
      remoteStatus,
      remoteTitle,
      remoteTime,
      castTime,
      remoteHeading,
      remoteInstructions;
  private Button localTab,
      remoteTab,
      castPlay,
      remotePlay,
      pairButton,
      castButton,
      cancelExport,
      disconnect;
  private SeekBar remoteSeek, remoteVolume, castSeek, castVolume;
  private EditText address, code;
  private PlayerView playerView;
  private ScrollView pageScroll;
  private FrameLayout screen, fullscreenPanel;
  private LinearLayout fullscreenToolbar;
  private final List<Button> fitButtons = new ArrayList<>(), fillButtons = new ArrayList<>();
  private boolean fullscreen = false, displayFill = false;
  private int playerIndex;
  private ExoPlayer player;
  private Uri selectedUri;
  private String selectedTitle = "영상을 선택해 주세요";
  private File subtitleFile, exportedFile;
  private CastContext castContext;
  private CastSession castSession;
  private RemoteMediaClient watchedClient;
  private RemoteMediaClient.Callback castCallback;
  private MediaRouteButton routeButton;
  private LocalMediaServer server;
  private Transformer transformer;
  private ProgressBar exportProgress;
  private boolean remoteMode = false,
      foreground = false,
      remoteBusy = false,
      pendingCast = false,
      castLoaded = false,
      remoteDragging = false,
      castDragging = false,
      destroyed = false;
  private int generation = 0, castLoadSerial = 0;
  private JSONObject remoteState = new JSONObject();
  private long remotePosition = 0, remoteDuration = 0;
  private final Runnable tick =
      new Runnable() {
        public void run() {
          if (destroyed) return;
          if (foreground) {
            if (remoteMode) pollRemote();
            else updateCast();
          }
          handler.postDelayed(this, 1000);
        }
      };
  private final SessionManagerListener<CastSession> castListener =
      new SessionManagerListener<CastSession>() {
        public void onSessionStarted(CastSession s, String id) {
          castSession = s;
          if (pendingCast) {
            pendingCast = false;
            prepareCast();
          } else localMessage("TV 연결됨 · TV 전송을 눌러 영상을 보냅니다.");
        }

        public void onSessionResumed(CastSession s, boolean suspended) {
          castSession = s;
        }

        public void onSessionEnded(CastSession s, int error) {
          castSession = null;
          endServing();
          localMessage("TV 연결이 종료되었습니다.");
        }

        public void onSessionSuspended(CastSession s, int reason) {
          localMessage("TV 연결이 끊겼습니다. 같은 Wi-Fi인지 확인하세요.");
        }

        public void onSessionStartFailed(CastSession s, int error) {
          pendingCast = false;
          localMessage("TV 연결 실패 (" + error + ")");
        }

        public void onSessionResumeFailed(CastSession s, int error) {
          castSession = null;
          endServing();
        }

        public void onSessionStarting(CastSession s) {}

        public void onSessionEnding(CastSession s) {}

        public void onSessionResuming(CastSession s, String id) {}
      };

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().setStatusBarColor(BG);
    getWindow().setNavigationBarColor(BG);
    buildUI();
    player = new ExoPlayer.Builder(this).build();
    playerView.setPlayer(player);
    player.addListener(
        new Player.Listener() {
          @Override
          public void onPlayerError(@NonNull PlaybackException error) {
            localMessage(
                "이 기기에서 재생할 수 없는 영상입니다. MP4(H.264/AAC)를 사용하거나 컴퓨터에서 열어 주세요.\n"
                    + error.getErrorCodeName());
          }
        });
    try {
      castContext = CastContext.getSharedInstance(this);
      CastButtonFactory.setUpMediaRouteButton(this, routeButton);
      castContext.getSessionManager().addSessionManagerListener(castListener, CastSession.class);
      castSession = castContext.getSessionManager().getCurrentCastSession();
    } catch (Exception e) {
      routeButton.setEnabled(false);
      localMessage("기기 재생은 사용할 수 있습니다. TV 전송에는 Google Play 서비스가 필요합니다.");
    }
    address.setText(getPreferences(MODE_PRIVATE).getString("desktopAddress", ""));
    handler.post(tick);
  }

  private int dp(int n) {
    return (int) (n * getResources().getDisplayMetrics().density + .5f);
  }

  private LinearLayout vertical() {
    LinearLayout l = new LinearLayout(this);
    l.setOrientation(LinearLayout.VERTICAL);
    return l;
  }

  private LinearLayout row() {
    LinearLayout l = new LinearLayout(this);
    l.setOrientation(LinearLayout.HORIZONTAL);
    l.setGravity(Gravity.CENTER_VERTICAL);
    return l;
  }

  private TextView text(String value, int size, int color) {
    TextView t = new TextView(this);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(color);
    t.setPadding(0, dp(5), 0, dp(5));
    return t;
  }

  private void gap(LinearLayout l, int height) {
    l.addView(new View(this), new LinearLayout.LayoutParams(1, dp(height)));
  }

  private GradientDrawable background(int color, int radius) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(radius));
    return d;
  }

  private Button button(String title, Runnable action) {
    Button b = new Button(this);
    b.setText(title);
    b.setTextColor(INK);
    b.setTextSize(14);
    b.setAllCaps(false);
    b.setBackground(background(PANEL, 12));
    b.setPadding(dp(8), 0, dp(8), 0);
    b.setOnClickListener(v -> action.run());
    return b;
  }

  private void addButton(LinearLayout row, Button b) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(48), 1);
    p.setMargins(dp(3), dp(4), dp(3), dp(4));
    row.addView(b, p);
  }

  private EditText input(String hint, int type) {
    EditText e = new EditText(this);
    e.setSingleLine(true);
    e.setTextColor(INK);
    e.setHintTextColor(MUTED);
    e.setHint(hint);
    e.setInputType(type);
    e.setTextSize(17);
    e.setBackground(background(PANEL, 12));
    e.setPadding(dp(16), dp(12), dp(16), dp(12));
    return e;
  }

  private int inlinePlayerHeight() {
    int width = getResources().getDisplayMetrics().widthPixels - dp(40);
    return Math.min(dp(380), Math.max(dp(200), width * 9 / 16));
  }

  private void addDisplayButtons(LinearLayout controls) {
    Button fit = button("원본 비율", () -> setDisplayFill(false));
    fit.setContentDescription("원본 비율");
    fitButtons.add(fit);
    addButton(controls, fit);
    Button fill = button("화면 채우기", () -> setDisplayFill(true));
    fill.setContentDescription("화면 채우기");
    fillButtons.add(fill);
    addButton(controls, fill);
  }

  private void setDisplayFill(boolean fill) {
    displayFill = fill;
    getPreferences(MODE_PRIVATE).edit().putBoolean("displayFill", fill).apply();
    applyDisplayMode();
    playerView.showController();
  }

  private void applyDisplayMode() {
    playerView.setResizeMode(
        displayFill
            ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            : AspectRatioFrameLayout.RESIZE_MODE_FIT);
    for (Button b : fitButtons) {
      b.setSelected(!displayFill);
      b.setTextColor(displayFill ? INK : BG);
      b.setBackground(background(displayFill ? PANEL : ACCENT, 12));
    }
    for (Button b : fillButtons) {
      b.setSelected(displayFill);
      b.setTextColor(displayFill ? BG : INK);
      b.setBackground(background(displayFill ? ACCENT : PANEL, 12));
    }
  }

  private void buildFullscreenPanel() {
    fullscreenPanel = new FrameLayout(this);
    fullscreenPanel.setBackgroundColor(Color.BLACK);
    fullscreenPanel.setVisibility(View.GONE);
    screen.addView(fullscreenPanel, new FrameLayout.LayoutParams(-1, -1));
    fullscreenToolbar = row();
    fullscreenToolbar.setPadding(dp(12), dp(12), dp(12), dp(12));
    fullscreenToolbar.setBackgroundColor(0x99000000);
    Button close = button("닫기", () -> setFullscreen(false));
    close.setContentDescription("전체화면 닫기");
    addButton(fullscreenToolbar, close);
    addDisplayButtons(fullscreenToolbar);
    fullscreenPanel.addView(fullscreenToolbar, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
    playerView.setControllerVisibilityListener(
        (PlayerView.ControllerVisibilityListener)
            visibility -> fullscreenToolbar.setVisibility(fullscreen ? visibility : View.GONE));
  }

  private void setFullscreen(boolean enabled) {
    if (fullscreen == enabled) return;
    fullscreen = enabled;
    // Move the existing view; the player, media item, clock, and subtitles stay intact.
    ((ViewGroup) playerView.getParent()).removeView(playerView);
    if (enabled) {
      pageScroll.setVisibility(View.GONE);
      fullscreenPanel.setVisibility(View.VISIBLE);
      fullscreenPanel.addView(playerView, 0, new FrameLayout.LayoutParams(-1, -1));
      fullscreenToolbar.setVisibility(View.VISIBLE);
    } else {
      localPage.addView(
          playerView, playerIndex, new LinearLayout.LayoutParams(-1, inlinePlayerHeight()));
      fullscreenPanel.setVisibility(View.GONE);
      pageScroll.setVisibility(View.VISIBLE);
    }
    WindowCompat.setDecorFitsSystemWindows(getWindow(), !enabled);
    updateSystemBars();
    playerView.showController();
  }

  private void updateSystemBars() {
    WindowInsetsControllerCompat bars =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (fullscreen) {
      bars.setSystemBarsBehavior(
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      bars.hide(WindowInsetsCompat.Type.systemBars());
    } else {
      bars.show(WindowInsetsCompat.Type.systemBars());
    }
  }

  @Override
  public void onConfigurationChanged(@NonNull Configuration config) {
    super.onConfigurationChanged(config);
    if (!fullscreen) {
      ViewGroup.LayoutParams params = playerView.getLayoutParams();
      params.height = inlinePlayerHeight();
      playerView.setLayoutParams(params);
    }
    updateSystemBars();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus && fullscreen) updateSystemBars();
  }

  private void buildUI() {
    displayFill = getPreferences(MODE_PRIVATE).getBoolean("displayFill", false);
    screen = new FrameLayout(this);
    ScrollView scroll = pageScroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setBackgroundColor(BG);
    root = vertical();
    root.setPadding(dp(20), dp(14), dp(20), dp(24));
    scroll.addView(root);
    screen.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
    setContentView(screen);
    TextView brand = text("▶  TOOPLAY", 23, ACCENT);
    brand.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    root.addView(brand);
    root.addView(text("내 영상, 원하는 화면으로", 14, MUTED));
    gap(root, 12);
    LinearLayout tabs = row();
    localTab = button("내 기기 영상", () -> switchMode(false));
    remoteTab = button("컴퓨터 연결", () -> switchMode(true));
    addButton(tabs, localTab);
    addButton(tabs, remoteTab);
    root.addView(tabs);
    gap(root, 18);
    localPage = vertical();
    root.addView(localPage);
    localTitle = text(selectedTitle, 20, INK);
    localTitle.setMaxLines(2);
    localTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    localPage.addView(localTitle);
    playerView = new PlayerView(this);
    playerView.setBackgroundColor(Color.BLACK);
    playerView.setKeepContentOnPlayerReset(true);
    if (playerView.getSubtitleView() != null) {
      playerView
          .getSubtitleView()
          .setStyle(
              new androidx.media3.ui.CaptionStyleCompat(
                  Color.WHITE,
                  Color.TRANSPARENT,
                  Color.TRANSPARENT,
                  androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                  Color.BLACK,
                  Typeface.DEFAULT_BOLD));
      // Keep captions on the screen, independent of the cropped video frame in fill mode.
      View captions = playerView.getSubtitleView();
      ((ViewGroup) captions.getParent()).removeView(captions);
      // Draw after the controls' dark scrim so captions stay readable while controls are visible.
      playerView.addView(captions, new FrameLayout.LayoutParams(-1, -1));
    }
    playerView.setKeepScreenOn(true);
    playerView.setControllerShowTimeoutMs(4000);
    playerIndex = localPage.getChildCount();
    localPage.addView(playerView, new LinearLayout.LayoutParams(-1, inlinePlayerHeight()));
    LinearLayout displayControls = row();
    addDisplayButtons(displayControls);
    Button expand = button("전체화면", () -> setFullscreen(true));
    expand.setContentDescription("전체화면");
    addButton(displayControls, expand);
    localPage.addView(displayControls);
    buildFullscreenPanel();
    applyDisplayMode();
    gap(localPage, 12);
    LinearLayout files = row();
    addButton(files, button("영상 열기", () -> choose(VIDEO_REQUEST, "video/*")));
    addButton(files, button("자막 열기", () -> choose(SUB_REQUEST, "*/*")));
    localPage.addView(files);
    LinearLayout castRow = row();
    castButton = button("TV 전송", this::requestCast);
    addButton(castRow, castButton);
    routeButton = new MediaRouteButton(this);
    routeButton.setContentDescription("Chromecast 기기 선택");
    castRow.addView(routeButton, new LinearLayout.LayoutParams(dp(56), dp(48)));
    localPage.addView(castRow);
    exportProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    exportProgress.setMax(100);
    exportProgress.setVisibility(View.GONE);
    localPage.addView(exportProgress, new LinearLayout.LayoutParams(-1, dp(8)));
    cancelExport =
        button(
            "전송 준비 취소",
            () -> {
              cancelPreparation();
              localMessage("전송 준비를 취소했습니다.");
            });
    cancelExport.setVisibility(View.GONE);
    localPage.addView(cancelExport);
    localStatus =
        text("영상은 기기에서 재생합니다. TV 전송은 같은 Wi-Fi에서 사용할 수 있습니다. 자막은 SRT · VTT를 지원합니다.", 14, MUTED);
    localPage.addView(localStatus);
    castTime = text("", 13, MUTED);
    localPage.addView(castTime);
    castSeek = new SeekBar(this);
    castSeek.setMax(1000);
    castSeek.setContentDescription("TV 재생 위치");
    localPage.addView(castSeek);
    castSeek.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar s) {
            castDragging = true;
          }

          public void onProgressChanged(SeekBar s, int p, boolean user) {}

          public void onStopTrackingTouch(SeekBar s) {
            castDragging = false;
            RemoteMediaClient c = castClient();
            if (c != null)
              c.seek(
                  new MediaSeekOptions.Builder()
                      .setPosition((long) (c.getStreamDuration() * s.getProgress() / 1000d))
                      .build());
          }
        });
    LinearLayout castControls = row();
    castPlay =
        button(
            "재생 / 일시정지",
            () -> {
              RemoteMediaClient c = castClient();
              if (c != null) {
                if (c.isPlaying()) c.pause();
                else c.play();
              }
            });
    addButton(castControls, castPlay);
    addButton(castControls, button("TV 전송 중지", this::stopCast));
    localPage.addView(castControls);
    castVolume = new SeekBar(this);
    castVolume.setMax(100);
    castVolume.setContentDescription("TV 볼륨");
    localPage.addView(castVolume);
    castVolume.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar s) {}

          public void onProgressChanged(SeekBar s, int p, boolean user) {
            if (user && castSession != null)
              try {
                castSession.setVolume(p / 100d);
              } catch (Exception e) {
                localMessage("TV 볼륨 변경 실패");
              }
          }

          public void onStopTrackingTouch(SeekBar s) {}
        });
    remotePage = vertical();
    root.addView(remotePage);
    remoteHeading = text("컴퓨터의 Tooplay 연결", 21, INK);
    remoteHeading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    remotePage.addView(remoteHeading);
    remoteInstructions =
        text("컴퓨터에서 ‘휴대폰 연결’을 켠 뒤 표시된 주소와 연결 코드 6자리를 입력하세요. 같은 Wi-Fi를 사용해야 합니다.", 14, MUTED);
    remotePage.addView(remoteInstructions);
    gap(remotePage, 12);
    address =
        input("192.168.1.20:43123", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    remotePage.addView(address, new LinearLayout.LayoutParams(-1, dp(54)));
    gap(remotePage, 8);
    code = input("연결 코드 6자리", InputType.TYPE_CLASS_NUMBER);
    code.setFilters(new android.text.InputFilter[] {new android.text.InputFilter.LengthFilter(6)});
    remotePage.addView(code, new LinearLayout.LayoutParams(-1, dp(54)));
    gap(remotePage, 8);
    pairButton = button("컴퓨터 연결", this::pair);
    remotePage.addView(pairButton, new LinearLayout.LayoutParams(-1, dp(50)));
    remoteStatus = text("연결 후 컴퓨터 또는 컴퓨터가 전송 중인 TV를 조작할 수 있습니다.", 14, MUTED);
    remotePage.addView(remoteStatus);
    gap(remotePage, 16);
    remoteControls = vertical();
    remotePage.addView(remoteControls);
    remoteTitle = text("", 21, INK);
    remoteTitle.setMaxLines(2);
    remoteControls.addView(remoteTitle);
    remoteTime = text("0:00 / 0:00", 14, MUTED);
    remoteControls.addView(remoteTime);
    remoteSeek = new SeekBar(this);
    remoteSeek.setMax(1000);
    remoteSeek.setContentDescription("컴퓨터 재생 위치");
    remoteControls.addView(remoteSeek);
    remoteSeek.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar s) {
            remoteDragging = true;
          }

          public void onProgressChanged(SeekBar s, int p, boolean user) {
            if (user)
              remoteTime.setText(clock(remoteDuration * p / 1000) + " / " + clock(remoteDuration));
          }

          public void onStopTrackingTouch(SeekBar s) {
            remoteDragging = false;
            command("seek", remoteDuration * s.getProgress() / 1000d, null);
          }
        });
    LinearLayout playback = row();
    addButton(
        playback, button("−10초", () -> command("seek", Math.max(0, remotePosition - 10), null)));
    remotePlay =
        button(
            "재생", () -> command(remoteState.optBoolean("playing") ? "pause" : "play", null, null));
    addButton(playback, remotePlay);
    addButton(
        playback,
        button("+10초", () -> command("seek", Math.min(remoteDuration, remotePosition + 10), null)));
    remoteControls.addView(playback);
    remoteControls.addView(text("볼륨", 13, MUTED));
    remoteVolume = new SeekBar(this);
    remoteVolume.setMax(100);
    remoteVolume.setContentDescription("컴퓨터 또는 TV 볼륨");
    remoteControls.addView(remoteVolume);
    remoteVolume.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar s) {}

          public void onProgressChanged(SeekBar s, int p, boolean user) {}

          public void onStopTrackingTouch(SeekBar s) {
            command("volume", s.getProgress() / 100d, null);
          }
        });
    LinearLayout destinations = row();
    addButton(destinations, button("자막 선택", this::chooseRemoteSubtitle));
    addButton(destinations, button("TV 선택", this::chooseRemoteCast));
    remoteControls.addView(destinations);
    LinearLayout stop = row();
    addButton(stop, button("TV 전송 중지", () -> command("cast-stop", null, null)));
    addButton(stop, button("영상 닫기", () -> command("stop", null, null)));
    remoteControls.addView(stop);
    disconnect = button("컴퓨터 연결 해제", this::disconnectRemote);
    remoteControls.addView(disconnect, new LinearLayout.LayoutParams(-1, dp(48)));
    remoteControls.setVisibility(View.GONE);
    switchMode(false);
    updateCast();
  }

  private void switchMode(boolean remoteMode) {
    this.remoteMode = remoteMode;
    localPage.setVisibility(remoteMode ? View.GONE : View.VISIBLE);
    remotePage.setVisibility(remoteMode ? View.VISIBLE : View.GONE);
    localTab.setTextColor(remoteMode ? MUTED : ACCENT);
    remoteTab.setTextColor(remoteMode ? ACCENT : MUTED);
    if (remoteMode) pollRemote();
  }

  private void choose(int request, String mime) {
    if (transformer != null) {
      localMessage("먼저 TV 전송 준비를 취소하세요.");
      return;
    }
    Intent i =
        new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType(mime)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    if (request == SUB_REQUEST)
      i.putExtra(
          Intent.EXTRA_MIME_TYPES,
          new String[] {
            "application/x-subrip", "text/vtt", "text/plain", "application/octet-stream"
          });
    startActivityForResult(i, request);
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (result != RESULT_OK || data == null || data.getData() == null) return;
    Uri uri = data.getData();
    try {
      getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
    } catch (Exception ignored) {
    }
    if (request == VIDEO_REQUEST) openVideo(uri);
    else if (request == SUB_REQUEST) openSubtitle(uri);
  }

  private String name(Uri uri) {
    try (Cursor c =
        getContentResolver()
            .query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) return c.getString(0);
    } catch (Exception ignored) {
    }
    return "내 영상";
  }

  private void openVideo(Uri uri) {
    stopCast();
    cancelPreparation();
    if (exportedFile != null) exportedFile.delete();
    exportedFile = null;
    if (subtitleFile != null) subtitleFile.delete();
    subtitleFile = null;
    selectedUri = uri;
    selectedTitle = name(uri);
    localTitle.setText(selectedTitle);
    setLocalMedia(0, true);
    localMessage("기기에서 재생 중 · TV 전송 시 720p 영상을 준비합니다.");
  }

  private void setLocalMedia(long position, boolean play) {
    if (selectedUri == null) return;
    MediaItem.Builder item = new MediaItem.Builder().setUri(selectedUri);
    if (subtitleFile != null) {
      MediaItem.SubtitleConfiguration subtitle =
          new MediaItem.SubtitleConfiguration.Builder(Uri.fromFile(subtitleFile))
              .setMimeType(MimeTypes.TEXT_VTT)
              .setLanguage("ko")
              .setLabel("선택한 자막")
              .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
              .build();
      item.setSubtitleConfigurations(Collections.singletonList(subtitle));
    }
    player.setMediaItem(item.build(), position);
    player.setPlayWhenReady(play);
    player.prepare();
  }

  private void openSubtitle(Uri uri) {
    if (selectedUri == null) {
      localMessage("먼저 영상을 선택하세요.");
      return;
    }
    int current = generation;
    long position = player.getCurrentPosition();
    boolean playing = player.isPlaying();
    localMessage("자막을 읽는 중…");
    io.execute(
        () -> {
          try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("자막 파일을 열 수 없습니다.");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) {
              if (bytes.size() + n > 4 * 1024 * 1024) throw new IOException("자막은 4MB 이하만 지원합니다.");
              bytes.write(buffer, 0, n);
            }
            String vtt = SubtitleCodec.toVtt(bytes.toByteArray());
            File file = new File(getCacheDir(), "subtitle-" + System.nanoTime() + ".vtt");
            try (FileOutputStream out = new FileOutputStream(file)) {
              out.write(vtt.getBytes(StandardCharsets.UTF_8));
            }
            handler.post(
                () -> {
                  if (destroyed || generation != current) {
                    file.delete();
                    return;
                  }
                  if (subtitleFile != null) subtitleFile.delete();
                  subtitleFile = file;
                  if (castLoaded) {
                    long castPosition =
                        castClient() != null
                            ? castClient().getApproximateStreamPosition()
                            : position;
                    loadCastFile(castPosition, castClient() == null || !castClient().isPaused());
                  } else setLocalMedia(position, playing);
                  localMessage("자막 적용: " + name(uri));
                });
          } catch (Exception e) {
            handler.post(() -> localMessage("자막 오류: " + e.getMessage()));
          }
        });
  }

  private void requestCast() {
    if (selectedUri == null) {
      localMessage("먼저 영상을 선택하세요.");
      return;
    }
    if (castContext == null) {
      localMessage("Google Play 서비스를 사용할 수 없는 기기입니다.");
      return;
    }
    castSession = castContext.getSessionManager().getCurrentCastSession();
    if (castSession == null || !castSession.isConnected()) {
      pendingCast = true;
      routeButton.performClick();
    } else prepareCast();
  }

  private void prepareCast() {
    if (selectedUri == null || transformer != null) return;
    if (exportedFile != null && exportedFile.isFile()) {
      loadCastFile(player.getCurrentPosition());
      return;
    }
    player.pause();
    long position = player.getCurrentPosition();
    int current = ++generation;
    File output = new File(getCacheDir(), "cast-" + System.nanoTime() + ".mp4");
    try {
      DefaultEncoderFactory encoder =
          new DefaultEncoderFactory.Builder(this)
              .setRequestedVideoEncoderSettings(
                  new VideoEncoderSettings.Builder().setBitrate(2500000).build())
              .build();
      transformer =
          new Transformer.Builder(this)
              .setVideoMimeType(MimeTypes.VIDEO_H264)
              .setAudioMimeType(MimeTypes.AUDIO_AAC)
              .setEncoderFactory(encoder)
              .addListener(
                  new Transformer.Listener() {
                    @Override
                    public void onCompleted(Composition composition, ExportResult result) {
                      if (destroyed || generation != current) {
                        output.delete();
                        return;
                      }
                      transformer = null;
                      finishPreparation();
                      exportedFile = output;
                      loadCastFile(position);
                    }

                    @Override
                    public void onError(
                        Composition composition, ExportResult result, ExportException error) {
                      output.delete();
                      if (generation != current) return;
                      transformer = null;
                      finishPreparation();
                      localMessage(
                          "TV용 영상 준비 실패. 저장 공간과 영상 형식을 확인하세요.\n" + error.getErrorCodeName());
                    }
                  })
              .build();
      Effects effects =
          new Effects(
              Collections.emptyList(),
              Arrays.asList(
                  Presentation.createForWidthAndHeight(1280, 720, Presentation.LAYOUT_SCALE_TO_FIT),
                  FrameDropEffect.createDefaultFrameDropEffect(30)));
      EditedMediaItem edited =
          new EditedMediaItem.Builder(MediaItem.fromUri(selectedUri)).setEffects(effects).build();
      exportProgress.setVisibility(View.VISIBLE);
      cancelExport.setVisibility(View.VISIBLE);
      castButton.setEnabled(false);
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      localMessage("720p · 30fps TV 영상을 준비합니다. 긴 영상은 시간이 걸립니다. 준비가 끝날 때까지 앱을 열어 두세요.");
      transformer.start(edited, output.getAbsolutePath());
      handler.post(
          new Runnable() {
            public void run() {
              if (transformer == null || generation != current) return;
              ProgressHolder p = new ProgressHolder();
              int state = transformer.getProgress(p);
              exportProgress.setIndeterminate(state != Transformer.PROGRESS_STATE_AVAILABLE);
              if (state == Transformer.PROGRESS_STATE_AVAILABLE)
                exportProgress.setProgress(p.progress);
              handler.postDelayed(this, 500);
            }
          });
    } catch (Exception e) {
      if (transformer != null) transformer.cancel();
      transformer = null;
      output.delete();
      finishPreparation();
      localMessage("TV 영상 준비를 시작할 수 없습니다: " + e.getMessage());
    }
  }

  private void cancelPreparation() {
    generation++;
    if (transformer != null) {
      transformer.cancel();
      transformer = null;
    }
    finishPreparation();
    File[] leftovers =
        getCacheDir().listFiles((d, n) -> n.startsWith("cast-") && n.endsWith(".mp4"));
    if (leftovers != null) for (File f : leftovers) if (!f.equals(exportedFile)) f.delete();
  }

  private void finishPreparation() {
    if (exportProgress == null) return;
    exportProgress.setVisibility(View.GONE);
    cancelExport.setVisibility(View.GONE);
    castButton.setEnabled(true);
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  private void loadCastFile(long position) {
    loadCastFile(position, true);
  }

  private void loadCastFile(long position, boolean autoplay) {
    if (exportedFile == null) return;
    if (!foreground) {
      localMessage("TV용 영상이 준비되었습니다. 앱을 열고 TV 전송을 다시 누르세요.");
      return;
    }
    castSession =
        castContext == null ? null : castContext.getSessionManager().getCurrentCastSession();
    RemoteMediaClient client = castClient();
    if (client == null) {
      localMessage("영상 준비가 끝났습니다. TV를 다시 연결한 뒤 전송하세요.");
      return;
    }
    try {
      clearCastWatch();
      if (server != null) server.stop();
      server = new LocalMediaServer(exportedFile, subtitleFile);
      server.start();
      final LocalMediaServer loadServer = server;
      final int loadSerial = ++castLoadSerial;
      final String loadURL = server.videoURL();
      MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
      metadata.putString(MediaMetadata.KEY_TITLE, selectedTitle);
      MediaInfo.Builder media =
          new MediaInfo.Builder(loadURL)
              .setContentType("video/mp4")
              .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
              .setMetadata(metadata);
      if (subtitleFile != null)
        media.setMediaTracks(
            Collections.singletonList(
                new MediaTrack.Builder(1, MediaTrack.TYPE_TEXT)
                    .setContentId(server.subtitleURL())
                    .setContentType("text/vtt")
                    .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
                    .setName("선택한 자막")
                    .setLanguage("ko")
                    .build()));
      MediaLoadRequestData.Builder request =
          new MediaLoadRequestData.Builder()
              .setMediaInfo(media.build())
              .setAutoplay(autoplay)
              .setCurrentTime(position);
      if (subtitleFile != null) request.setActiveTrackIds(new long[] {1});
      watchedClient = client;
      castCallback =
          new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
              MediaStatus status = client.getMediaStatus();
              if (loadSerial == castLoadSerial
                  && server == loadServer
                  && status != null
                  && status.getMediaInfo() != null
                  && loadURL.equals(status.getMediaInfo().getContentId())
                  && status.getPlayerState() == MediaStatus.PLAYER_STATE_IDLE
                  && status.getIdleReason() == MediaStatus.IDLE_REASON_FINISHED) {
                endServing();
                localMessage("TV 재생이 끝났습니다.");
              }
            }
          };
      client.registerCallback(castCallback);
      client
          .load(request.build())
          .setResultCallback(
              result -> {
                if (destroyed || loadSerial != castLoadSerial || server != loadServer) return;
                if (!result.getStatus().isSuccess()) {
                  endServing();
                  localMessage(
                      "TV에서 영상을 열 수 없습니다. Wi-Fi와 기기를 확인하세요. ("
                          + result.getStatus().getStatusCode()
                          + ")");
                }
              });
      player.pause();
      castLoaded = true;
      playerView.setUseController(false);
      if (Build.VERSION.SDK_INT >= 33
          && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
              != PackageManager.PERMISSION_GRANTED)
        requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 20);
      ContextCompat.startForegroundService(this, new Intent(this, CastServingService.class));
      localMessage("TV 전송 중 · 720p / 30fps · 준비된 파일을 전송합니다.");
      updateCast();
    } catch (Exception e) {
      endServing();
      localMessage("TV 전송 실패: " + e.getMessage());
    }
  }

  private RemoteMediaClient castClient() {
    return castSession == null ? null : castSession.getRemoteMediaClient();
  }

  private void stopCast() {
    pendingCast = false;
    cancelPreparation();
    RemoteMediaClient client = castClient();
    if (castLoaded && client != null) {
      long position = client.getApproximateStreamPosition();
      client.stop();
      if (player != null) player.seekTo(position);
    }
    endServing();
  }

  private void clearCastWatch() {
    if (watchedClient != null && castCallback != null)
      watchedClient.unregisterCallback(castCallback);
    watchedClient = null;
    castCallback = null;
  }

  private void endServing() {
    castLoadSerial++;
    clearCastWatch();
    castLoaded = false;
    if (server != null) {
      server.stop();
      server = null;
    }
    stopService(new Intent(this, CastServingService.class));
    if (playerView != null) playerView.setUseController(true);
    updateCast();
  }

  private void updateCast() {
    if (castPlay == null) return;
    RemoteMediaClient c = castClient();
    boolean active = castLoaded && c != null;
    castPlay.setEnabled(active);
    castSeek.setEnabled(active);
    castVolume.setEnabled(active);
    if (active) {
      long position = c.getApproximateStreamPosition(), duration = c.getStreamDuration();
      castTime.setText("TV  " + clock(position / 1000) + " / " + clock(duration / 1000));
      if (!castDragging)
        castSeek.setProgress(duration > 0 ? (int) (position * 1000d / duration) : 0);
      castPlay.setText(c.isPlaying() ? "일시정지" : "재생");
      try {
        castVolume.setProgress((int) (castSession.getVolume() * 100));
      } catch (Exception ignored) {
      }
    } else castTime.setText("TV가 연결되면 전송 조절 버튼을 사용할 수 있습니다.");
  }

  private void localMessage(String value) {
    if (!destroyed && localStatus != null) localStatus.setText(value);
  }

  private String clock(long seconds) {
    seconds = Math.max(0, seconds);
    return seconds >= 3600
        ? String.format(
            Locale.US, "%d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60)
        : String.format(Locale.US, "%d:%02d", seconds / 60, seconds % 60);
  }

  private void pair() {
    if (remoteBusy) return;
    String addr = address.getText().toString(), pin = code.getText().toString();
    remoteBusy = true;
    pairButton.setEnabled(false);
    remoteStatus.setText("컴퓨터에 연결하는 중…");
    io.execute(
        () -> {
          try {
            JSONObject result = remote.pair(addr, pin);
            JSONObject state = remote.state();
            handler.post(
                () -> {
                  if (destroyed) return;
                  getPreferences(MODE_PRIVATE)
                      .edit()
                      .putString("desktopAddress", remote.address())
                      .apply();
                  code.setText("");
                  remoteStatus.setText(result.optString("serverName", "Tooplay") + " 연결됨");
                  remoteBusy = false;
                  pairButton.setEnabled(true);
                  renderRemote(state);
                });
          } catch (Exception e) {
            handler.post(
                () -> {
                  remoteBusy = false;
                  pairButton.setEnabled(true);
                  remoteStatus.setText("연결 실패: " + e.getMessage());
                });
          }
        });
  }

  private void pollRemote() {
    if (!foreground || !remoteMode || !remote.paired() || remoteBusy) return;
    remoteBusy = true;
    io.execute(
        () -> {
          try {
            JSONObject result = remote.state();
            handler.post(
                () -> {
                  remoteBusy = false;
                  if (!destroyed) renderRemote(result);
                });
          } catch (Exception e) {
            handler.post(
                () -> {
                  remoteBusy = false;
                  if (destroyed) return;
                  remoteStatus.setText("연결 확인: " + e.getMessage());
                  if (!remote.paired()) resetPairingUI();
                });
          }
        });
  }

  private void renderRemote(JSONObject state) {
    remoteHeading.setText("컴퓨터 리모컨");
    remoteInstructions.setVisibility(View.GONE);
    address.setVisibility(View.GONE);
    code.setVisibility(View.GONE);
    remoteState = state;
    remoteControls.setVisibility(View.VISIBLE);
    pairButton.setVisibility(View.GONE);
    address.setEnabled(false);
    code.setEnabled(false);
    remoteTitle.setText(
        state.optBoolean("hasMedia") ? state.optString("title", "영상") : "컴퓨터에서 영상을 열어 주세요");
    remotePosition = Math.max(0, (long) state.optDouble("currentTime", 0));
    remoteDuration = Math.max(0, (long) state.optDouble("duration", 0));
    if (!remoteDragging) {
      remoteSeek.setProgress(
          remoteDuration > 0 ? (int) (remotePosition * 1000d / remoteDuration) : 0);
      remoteTime.setText(clock(remotePosition) + " / " + clock(remoteDuration));
    }
    remotePlay.setText(state.optBoolean("playing") ? "일시정지" : "재생");
    boolean ready = state.optBoolean("hasMedia") && !state.optBoolean("preparing");
    remotePlay.setEnabled(ready);
    remoteSeek.setEnabled(ready);
    remoteVolume.setProgress((int) (state.optDouble("volume", 1) * 100));
    String error = state.optString("lastError", "");
    if ("null".equals(error)) error = "";
    remoteStatus.setText(
        !error.isEmpty()
            ? error
            : state.optBoolean("preparing")
                ? "컴퓨터에서 TV 영상을 준비하는 중…"
                : state.optBoolean("casting") ? "컴퓨터가 TV로 전송 중 · 이 화면에서 조작합니다." : "컴퓨터 재생을 조작합니다.");
  }

  private void command(String action, Number value, String id) {
    if (!remote.paired()) {
      remoteStatus.setText("컴퓨터를 먼저 연결하세요.");
      return;
    }
    try {
      JSONObject body = new JSONObject().put("command", action);
      if (value != null) body.put("value", value);
      if ("cast-connect".equals(action)) body.put("deviceId", id);
      if ("subtitle".equals(action)) body.put("trackId", id == null ? JSONObject.NULL : id);
      remoteBusy = true;
      io.execute(
          () -> {
            try {
              remote.command(body);
              JSONObject state = remote.state();
              handler.post(
                  () -> {
                    remoteBusy = false;
                    if (!destroyed) renderRemote(state);
                  });
            } catch (Exception e) {
              handler.post(
                  () -> {
                    remoteBusy = false;
                    if (!destroyed) {
                      remoteStatus.setText("조작 실패: " + e.getMessage());
                      if (!remote.paired()) resetPairingUI();
                    }
                  });
            }
          });
    } catch (JSONException e) {
      remoteStatus.setText("명령을 만들 수 없습니다.");
    }
  }

  private void chooseRemoteSubtitle() {
    JSONArray tracks = remoteState.optJSONArray("subtitles");
    ArrayList<String> names = new ArrayList<>(), ids = new ArrayList<>();
    names.add("자막 끄기");
    ids.add(null);
    if (tracks != null)
      for (int i = 0; i < tracks.length(); i++) {
        JSONObject item = tracks.optJSONObject(i);
        if (item != null) {
          names.add(item.optString("name", "자막"));
          ids.add(item.optString("id"));
        }
      }
    new AlertDialog.Builder(this)
        .setTitle("컴퓨터 자막")
        .setItems(
            names.toArray(new String[0]), (d, which) -> command("subtitle", null, ids.get(which)))
        .setNegativeButton("취소", null)
        .show();
  }

  private void chooseRemoteCast() {
    JSONArray devices = remoteState.optJSONArray("devices");
    if (devices == null || devices.length() == 0) {
      remoteStatus.setText("발견된 TV가 없습니다. 컴퓨터와 TV가 같은 Wi-Fi인지 확인하세요.");
      return;
    }
    ArrayList<String> names = new ArrayList<>(), ids = new ArrayList<>();
    for (int i = 0; i < devices.length(); i++) {
      JSONObject item = devices.optJSONObject(i);
      if (item != null) {
        names.add(item.optString("name", "TV"));
        ids.add(item.optString("id"));
      }
    }
    new AlertDialog.Builder(this)
        .setTitle("컴퓨터에서 전송할 TV")
        .setItems(
            names.toArray(new String[0]),
            (d, which) -> command("cast-connect", null, ids.get(which)))
        .setNegativeButton("취소", null)
        .show();
  }

  private void resetPairingUI() {
    remoteHeading.setText("컴퓨터의 Tooplay 연결");
    remoteInstructions.setVisibility(View.VISIBLE);
    address.setVisibility(View.VISIBLE);
    code.setVisibility(View.VISIBLE);
    remoteControls.setVisibility(View.GONE);
    pairButton.setVisibility(View.VISIBLE);
    address.setEnabled(true);
    code.setEnabled(true);
    code.setText("");
  }

  private void disconnectRemote() {
    remoteBusy = true;
    io.execute(
        () -> {
          remote.disconnect();
          handler.post(
              () -> {
                remoteBusy = false;
                if (destroyed) return;
                resetPairingUI();
                remoteStatus.setText("컴퓨터 연결을 해제했습니다.");
              });
        });
  }

  @Override
  protected void onStart() {
    super.onStart();
    foreground = true;
  }

  @Override
  protected void onStop() {
    foreground = false;
    if (!castLoaded) {
      pendingCast = false;
      if (transformer != null) {
        cancelPreparation();
        localMessage("앱을 나가 TV 영상 준비가 취소되었습니다. 다시 전송하려면 앱을 열어 두세요.");
      }
      if (player != null) player.pause();
    }
    super.onStop();
  }

  @Override
  public void onBackPressed() {
    if (fullscreen) {
      setFullscreen(false);
    } else if (transformer != null) {
      new AlertDialog.Builder(this)
          .setTitle("TV 영상 준비 중")
          .setMessage("나가면 준비가 취소됩니다.")
          .setPositiveButton(
              "취소하고 나가기",
              (d, w) -> {
                cancelPreparation();
                super.onBackPressed();
              })
          .setNegativeButton("계속 준비", null)
          .show();
    } else if (castLoaded) {
      moveTaskToBack(true);
    } else super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    destroyed = true;
    handler.removeCallbacksAndMessages(null);
    if (transformer != null) transformer.cancel();
    if (castContext != null)
      castContext.getSessionManager().removeSessionManagerListener(castListener, CastSession.class);
    if (castLoaded && castClient() != null) castClient().stop();
    endServing();
    if (player != null) player.release();
    io.execute(remote::disconnect);
    io.shutdown();
    super.onDestroy();
  }
}
