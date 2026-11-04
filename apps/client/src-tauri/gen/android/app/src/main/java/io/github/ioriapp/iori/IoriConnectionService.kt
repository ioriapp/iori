package io.github.ioriapp.iori

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/** Holds the process and CPU for the existing encrypted Host connections.
 * Terminal subscriptions still detach when the Activity goes to the background. */
class IoriConnectionService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val name = if (resources.configuration.locales[0].language == "ja") "バックグラウンドの接続" else "Background connection"
      manager.createNotificationChannel(NotificationChannel("iori-connection", name, NotificationManager.IMPORTANCE_LOW))
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)!!
    val pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, "iori-connection")
      .setSmallIcon(resources.getIdentifier("ic_stat_iori", "drawable", packageName))
      .setContentTitle(intent?.getStringExtra("title") ?: "iori")
      .setContentText(intent?.getStringExtra("body") ?: "")
      .setContentIntent(pending).setOngoing(true).build()
    startForeground(1, notification)
    if (wakeLock == null) {
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "iori:host-connection").apply { acquire() }
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }
}
