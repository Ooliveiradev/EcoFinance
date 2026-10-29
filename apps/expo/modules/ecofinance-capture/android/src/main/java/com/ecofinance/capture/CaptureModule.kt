package com.ecofinance.capture

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Bridge for the optional capture (#19). Nothing runs until the user grants access and picks apps. */
class CaptureModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "React context unavailable" }
  private val store get() = CaptureStore(context)

  override fun definition() = ModuleDefinition {
    Name("EcoFinanceCapture")

    /** Notification access is granted by the user in system settings, never by the app itself. */
    Function("isAccessGranted") {
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      val component = ComponentName(context, CaptureListenerService::class.java)
      enabled.split(':').any { ComponentName.unflattenFromString(it) == component }
    }
    Function("openAccessSettings") {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    /** `owner` null turns capture off on this device and erases its queue. */
    Function("configure") { owner: String?, packages: List<String> -> store.configure(owner, packages) }
    Function("peek") { limit: Int -> store.peek(limit.coerceIn(1, 50)) }
    Function("remove") { ids: List<String> -> store.remove(ids) }
    Function("clear") { store.clear() }
    Function("status") { store.status() }
  }
}
