package com.ecofinance.capture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Runs while the user keeps notification access granted, even with the app's UI
 * closed. Android delivers notices from every app; anything outside the packages
 * the user chose, without readable text, or carrying a code/password is discarded
 * here, before it is stored or sent.
 */
class CaptureListenerService : NotificationListenerService() {
  override fun onListenerConnected() { CaptureStore(this).setConnected(true) }
  override fun onListenerDisconnected() { CaptureStore(this).setConnected(false) }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val store = CaptureStore(this)
    val owner = store.owner ?: return
    if (sbn.packageName !in store.packages) return
    val notification = sbn.notification ?: return
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val extras = notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.take(200)
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim()
    // Hidden content (lock screen privacy, "sensitive content") is not reconstructed.
    if (text.isNullOrEmpty()) return
    if (SENSITIVE.containsMatchIn("${title.orEmpty()} $text")) return
    val postedAt = ISO.get()!!.format(Date(sbn.postTime))
    store.enqueue(JSONObject()
      .put("id", "${sbn.packageName}|${sbn.key}|${sbn.postTime}").put("owner", owner)
      .put("package", sbn.packageName).put("key", sbn.key.take(200)).put("postedAt", postedAt)
      .put("title", title ?: JSONObject.NULL).put("text", text.take(500)))
  }

  companion object {
    private val SENSITIVE = Regex("(?i)\\b(c[oó]digo|senha|token|otp)\\b")
    private val ISO = ThreadLocal.withInitial {
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    }
  }
}
