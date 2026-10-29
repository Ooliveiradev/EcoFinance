package com.ecofinance.capture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Private queue of captured notices (#19), in app-only SharedPreferences (backups are
 * disabled for the app). Every notice is tagged with the signed-in user; a different
 * user, a logout or turning capture off never reuses another user's queue.
 */
class CaptureStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("ecofinance_capture", Context.MODE_PRIVATE)

  val owner: String? get() = prefs.getString(OWNER, null)
  val packages: Set<String> get() = prefs.getStringSet(PACKAGES, emptySet()) ?: emptySet()

  /** Changing the user (or turning capture off with a null owner) drops the previous queue. */
  @Synchronized
  fun configure(owner: String?, packages: List<String>) {
    val editor = prefs.edit()
    if (owner == null || owner != this.owner) editor.putString(QUEUE, "[]").putInt(DROPPED, 0)
    if (owner == null) editor.remove(OWNER).remove(PACKAGES)
    else editor.putString(OWNER, owner).putStringSet(PACKAGES, packages.take(MAX_PACKAGES).toSet())
    editor.apply()
  }

  @Synchronized
  fun enqueue(event: JSONObject) {
    val queue = queue()
    val id = event.getString("id")
    for (i in 0 until queue.length()) if (queue.getJSONObject(i).getString("id") == id) return
    queue.put(event)
    var dropped = prefs.getInt(DROPPED, 0)
    // Bounded: the oldest notices go first and the loss is reported to the user.
    while (queue.length() > MAX_QUEUE) { queue.remove(0); dropped++ }
    prefs.edit().putString(QUEUE, queue.toString()).putInt(DROPPED, dropped).putLong(LAST_EVENT, System.currentTimeMillis()).apply()
  }

  @Synchronized
  fun peek(limit: Int): List<Map<String, Any?>> {
    val owner = owner ?: return emptyList()
    val queue = queue()
    val result = mutableListOf<Map<String, Any?>>()
    for (i in 0 until queue.length()) {
      val item = queue.getJSONObject(i)
      if (item.optString("owner") != owner) continue
      result.add(mapOf(
        "id" to item.getString("id"), "package" to item.getString("package"), "key" to item.getString("key"),
        "postedAt" to item.getString("postedAt"), "title" to (if (item.isNull("title")) null else item.getString("title")),
        "text" to item.getString("text"),
      ))
      if (result.size >= limit) break
    }
    return result
  }

  @Synchronized
  fun remove(ids: List<String>) {
    val drop = ids.toSet()
    val queue = queue()
    val kept = JSONArray()
    for (i in 0 until queue.length()) if (queue.getJSONObject(i).getString("id") !in drop) kept.put(queue.getJSONObject(i))
    prefs.edit().putString(QUEUE, kept.toString()).apply()
  }

  @Synchronized
  fun clear() { prefs.edit().clear().apply() }

  fun status(): Map<String, Any?> = mapOf(
    "owner" to owner, "packages" to packages.toList(), "queued" to queue().length(),
    "dropped" to prefs.getInt(DROPPED, 0), "lastEventAt" to prefs.getLong(LAST_EVENT, 0L).takeIf { it > 0 }?.toDouble(),
    "connected" to prefs.getBoolean(CONNECTED, false),
  )

  fun setConnected(connected: Boolean) { prefs.edit().putBoolean(CONNECTED, connected).apply() }

  private fun queue(): JSONArray = try { JSONArray(prefs.getString(QUEUE, "[]")) } catch (_: Exception) { JSONArray() }

  companion object {
    const val MAX_QUEUE = 200
    const val MAX_PACKAGES = 20
    private const val OWNER = "owner"
    private const val PACKAGES = "packages"
    private const val QUEUE = "queue"
    private const val DROPPED = "dropped"
    private const val LAST_EVENT = "lastEventAt"
    private const val CONNECTED = "connected"
  }
}
