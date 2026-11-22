package io.github.ioriapp.iori

import android.app.Activity
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions
import java.lang.ref.WeakReference

@InvokeArg
class ViewArgs {
  lateinit var value: String
}

@TauriPlugin
class IoriNativePlugin(private val activity: Activity) : Plugin(activity) {
  private val storage = IoriKeystore(activity)
  private val ui = IoriActivityBridge(activity)
  private val push = IoriUnifiedPush(activity) { event -> trigger("unifiedpush", event) }

  companion object {
    private var pushPlugin = WeakReference<IoriNativePlugin>(null)
    fun pushChanged() { pushPlugin.get()?.push?.deliverPushEvent() }
  }

  override fun onPause() = push.onPause()
  override fun onResume() = push.onResume()

  override fun load(webView: WebView) {
    pushPlugin = WeakReference(this)
    ui.load(webView)
  }

  @Command
  fun notificationReady(invoke: Invoke) = ui.notificationReady(invoke)

  @Command
  fun backgroundConnection(invoke: Invoke) = ui.backgroundConnection(invoke)

  @Command
  fun deleteSavedDocument(invoke: Invoke) = ui.deleteSavedDocument(invoke)

  @Command
  fun showKeyboard(invoke: Invoke) = ui.showKeyboard(invoke)

  @Command
  fun defaultBack(invoke: Invoke) = ui.defaultBack(invoke)

  @Command
  fun unifiedPushDistributors(invoke: Invoke) = push.unifiedPushDistributors(invoke)

  @Command
  fun unifiedPushRegister(invoke: Invoke) = push.unifiedPushRegister(invoke)

  @Command
  fun unifiedPushUnregister(invoke: Invoke) = push.unifiedPushUnregister(invoke)

  @Command
  fun unifiedPushState(invoke: Invoke) = push.unifiedPushState(invoke)

  @Command
  fun protectView(invoke: Invoke) = storage.protectView(invoke)

  @Command
  fun unprotectView(invoke: Invoke) = storage.unprotectView(invoke)

  @Command
  fun getIdentity(invoke: Invoke) = storage.getIdentity(invoke)

  @Command
  fun scanQr(invoke: Invoke) {
    try {
      val options = ScanOptions()
        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        .setPrompt(scanPrompt())
        .setOrientationLocked(false)
        .setBeepEnabled(false)
        .setBarcodeImageEnabled(false)
      val intent = options.createScanIntent(activity)
      startActivityForResult(invoke, intent, "scanQrResult")
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not start the QR scanner")
    }
  }

  @ActivityCallback
  fun scanQrResult(invoke: Invoke, result: ActivityResult) {
    try {
      val scanned = ScanIntentResult.parseActivityResult(result.resultCode, result.data)
      val contents = scanned.contents
      if (result.resultCode != Activity.RESULT_OK || contents.isNullOrEmpty()) {
        invoke.reject("QR scanning was cancelled or did not return a code")
        return
      }
      invoke.resolve(JSObject().put("value", contents))
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not read the QR result")
    }
  }

  private fun scanPrompt(): String {
    return if (activity.resources.configuration.locales[0].language == "ja") {
      "招待のQRコードを読み取ってください"
    } else {
      "Scan the invitation QR code"
    }
  }
}
