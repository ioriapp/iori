package io.github.ioriapp.iori

import android.app.Activity
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.unifiedpush.android.connector.UnifiedPush

@InvokeArg
class UnifiedPushArgs { var distributor: String = ""; var events: Boolean? = null }

internal class IoriUnifiedPush(
  private val activity: Activity,
  private val emit: (JSObject) -> Unit,
) {
  private var pushEventsReady = false
  private var resumed = true

  fun deliverPushEvent() {
    activity.runOnUiThread {
      if (pushEventsReady && resumed) {
        val preferences = IoriPushService.preferences(activity)
        preferences.getString("event", null)?.let {
          preferences.edit().remove("event").apply()
          emit(JSObject(it))
        }
      }
    }
  }

  fun onPause() { resumed = false }
  fun onResume() { resumed = true; deliverPushEvent() }

  fun unifiedPushDistributors(invoke: Invoke) {
    try {
      val distributors = org.json.JSONArray()
      for (id in UnifiedPush.getDistributors(activity)) {
        val info = activity.packageManager.getApplicationInfo(id, 0)
        distributors.put(JSObject().put("id", id).put("name", activity.packageManager.getApplicationLabel(info).toString()))
      }
      invoke.resolve(JSObject().put("distributors", distributors))
    } catch (error: Exception) { invoke.reject(error.message ?: "Could not list UnifiedPush distributors") }
  }

  fun unifiedPushRegister(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        val distributor = invoke.parseArgs(UnifiedPushArgs::class.java).distributor
        require(UnifiedPush.getDistributors(activity).contains(distributor))
        if (UnifiedPush.getSavedDistributor(activity) != distributor) {
          UnifiedPush.unregister(activity, instance = IoriPushService.INSTANCE)
          IoriPushService.preferences(activity).edit().clear().apply()
        }
        UnifiedPush.saveDistributor(activity, distributor)
        IoriPushService.preferences(activity).edit().remove("event").apply()
        UnifiedPush.register(activity, instance = IoriPushService.INSTANCE)
        invoke.resolve()
      } catch (error: Exception) { invoke.reject(error.message ?: "Could not register UnifiedPush") }
    }
  }

  fun unifiedPushUnregister(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        UnifiedPush.unregister(activity, instance = IoriPushService.INSTANCE)
        // The connector removes its registration synchronously; distributors need
        // not send an onUnregistered callback for a local unregister request.
        IoriPushService.unregistered(activity)
        invoke.resolve()
      } catch (error: Exception) { invoke.reject(error.message ?: "Could not unregister UnifiedPush") }
    }
  }

  fun unifiedPushState(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        invoke.parseArgs(UnifiedPushArgs::class.java).events?.let { pushEventsReady = it }
        val state = JSObject()
        val distributor = UnifiedPush.getSavedDistributor(activity)
        if (distributor != null) {
          state.put("distributor", distributor)
          IoriPushService.preferences(activity).getString("subscription", null)?.let {
            state.put("subscription", org.json.JSONObject(it))
          }
        }
        invoke.resolve(state)
        deliverPushEvent()
      } catch (error: Exception) { invoke.reject(error.message ?: "Could not read UnifiedPush state") }
    }
  }
}
