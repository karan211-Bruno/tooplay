package com.tooplay.mobile;

import android.app.*;
import android.content.*;
import android.os.*;
import androidx.core.app.NotificationCompat;

public class CastServingService extends Service {
  private PowerManager.WakeLock wakeLock;

  public void onCreate() {
    super.onCreate();
    NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= 26)
      manager.createNotificationChannel(
          new NotificationChannel("cast", "TV 전송", NotificationManager.IMPORTANCE_LOW));
    Intent activity =
        new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent open =
        PendingIntent.getActivity(
            this, 0, activity, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification notification =
        new NotificationCompat.Builder(this, "cast")
            .setSmallIcon(R.drawable.ic_tooplay)
            .setContentTitle("Tooplay · TV 전송 중")
            .setContentText("앱에서 전송을 중지할 수 있습니다.")
            .setContentIntent(open)
            .setOngoing(true)
            .build();
    startForeground(41, notification);
    wakeLock =
        ((PowerManager) getSystemService(POWER_SERVICE))
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tooplay:Cast");
    wakeLock.acquire(6 * 60 * 60 * 1000L);
  }

  public int onStartCommand(Intent intent, int flags, int startId) {
    return START_NOT_STICKY;
  }

  public IBinder onBind(Intent intent) {
    return null;
  }

  public void onDestroy() {
    if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    super.onDestroy();
  }
}
