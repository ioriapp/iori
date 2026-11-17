package io.github.ioriapp.iori

import android.content.Context
import app.tauri.notification.Notification
import app.tauri.notification.NotificationStorage
import app.tauri.notification.TauriNotificationManager
import app.tauri.plugin.JSObject
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

class IoriPushService : PushService() {
    companion object {
        const val INSTANCE = "iori"
        fun preferences(context: Context) = context.getSharedPreferences("iori_unifiedpush", Context.MODE_PRIVATE)

        private fun event(context: Context, value: JSONObject) {
            preferences(context).edit().putString("event", value.toString()).apply()
            IoriNativePlugin.pushChanged()
        }

        fun unregistered(context: Context) {
            preferences(context).edit().clear().apply()
            event(context, JSONObject().put("kind", "unregistered"))
        }
    }

    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
        if (instance != INSTANCE) return
        val keys = endpoint.pubKeySet ?: return
        val subscription = JSONObject().put("endpoint", endpoint.url).put("keys", JSONObject()
            .put("p256dh", keys.pubKey).put("auth", keys.auth))
        preferences(this).edit().putString("subscription", subscription.toString()).apply()
        event(this, JSONObject().put("kind", "endpoint").put("subscription", subscription))
    }

    override fun onMessage(message: PushMessage, instance: String) {
        if (instance != INSTANCE || !message.decrypted) return
        // Validate the wire payload before handing it to the same notification
        // implementation used by native.notify, including its click intent extras.
        val payload = try { JSONObject(message.content.toString(Charsets.UTF_8)) } catch (_: Exception) { return }
        if (payload.opt("v") != 1 || payload.opt("id") !is Int ||
            payload.opt("title") !is String || payload.opt("body") !is String) return
        val target = payload.optJSONObject("target") ?: return
        if (target.opt("hostKey") !is String || target.opt("terminalId") !is String) return
        val notification = Notification().apply {
            id = payload.getInt("id")
            title = payload.getString("title")
            body = payload.getString("body")
            icon = "ic_stat_iori"
            extra = JSObject().put("target", JSONObject()
                .put("hostKey", target.getString("hostKey"))
                .put("terminalId", target.getString("terminalId")))
            sourceJson = JSONObject().put("id", id).put("title", title).put("body", body)
                .put("icon", icon).put("extra", extra).toString()
        }
        val manager = TauriNotificationManager(NotificationStorage(this, ObjectMapper()), null, this, null)
        if (!manager.areNotificationsEnabled()) return
        manager.createNotificationChannel()
        manager.schedule(notification)
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        if (instance != INSTANCE) return
        val failure = when (reason) {
            FailedReason.ACTION_REQUIRED -> "action_required"
            FailedReason.NETWORK -> "network"
            FailedReason.INTERNAL_ERROR -> "internal"
            FailedReason.VAPID_REQUIRED -> "vapid_required"
        }
        event(this, JSONObject().put("kind", "failed").put("reason", failure))
    }

    override fun onUnregistered(instance: String) {
        if (instance == INSTANCE) unregistered(this)
    }

    // A temporary distributor outage does not invalidate the saved endpoint.
    override fun onTempUnavailable(instance: String) {}
}
