package io.github.ioriapp.iori

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject

@InvokeArg
class BackgroundConnectionArgs { var enabled: Boolean = false; var title: String = "iori"; var body: String = "" }

internal class IoriActivityBridge(private val activity: Activity) {
  private var webView: WebView? = null
  private var launchNotification = activity.intent?.takeIf {
    it.hasExtra(app.tauri.notification.NOTIFICATION_INTENT_KEY)
  }?.let { Intent(it) }

  fun notificationReady(invoke: Invoke) {
    activity.runOnUiThread {
      launchNotification?.let { intent ->
        launchNotification = null
        // NotificationPlugin.load handles the launch intent before Rust can
        // register its action listener. Replay it once after that listener exists.
        app.tauri.notification.NotificationPlugin.instance?.onIntent(intent)
      }
      invoke.resolve()
    }
  }

  fun load(webView: WebView) {
    this.webView = webView
    // Android draws edge-to-edge. Keep the whole WebView inside the actual
    // system bars and cutouts so both fixed headers and dialogs remain usable.
    // The on-screen keyboard shrinks the WebView (the IME inset already
    // contains the navigation bar), so the page does not slide up behind it
    // and the layout above the keyboard keeps its place.
    val content = activity.findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }

  fun backgroundConnection(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        val args = invoke.parseArgs(BackgroundConnectionArgs::class.java)
        val intent = Intent(activity, IoriConnectionService::class.java).putExtra("title", args.title).putExtra("body", args.body)
        if (args.enabled) {
          if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            error("Notification permission is required")
          androidx.core.content.ContextCompat.startForegroundService(activity, intent)
        } else activity.stopService(intent)
        invoke.resolve(JSObject())
      } catch (error: Exception) { invoke.reject(error.message ?: "Could not change background connection") }
    }
  }

  // Called only for the URI returned by our save picker, after a failed or
  // cancelled download. ACTION_CREATE_DOCUMENT never replaces an old file.
  fun deleteSavedDocument(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ViewArgs::class.java)
      if (!DocumentsContract.deleteDocument(activity.contentResolver, Uri.parse(args.value)))
        error("Could not remove the unfinished document")
      invoke.resolve(JSObject())
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not remove the unfinished document")
    }
  }

  // The terminal turns a finger tap into its own gesture and cancels the touch,
  // so the WebView never shows the keyboard for the focus a tap gives it.
  fun showKeyboard(invoke: Invoke) {
    activity.runOnUiThread {
      webView?.let { view ->
        view.requestFocus()
        val manager = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        manager.showSoftInput(view, 0)
      }
      invoke.resolve(JSObject())
    }
  }

  fun defaultBack(invoke: Invoke) {
    activity.runOnUiThread {
      (activity as AppCompatActivity).onBackPressedDispatcher.onBackPressed()
      invoke.resolve(JSObject())
    }
  }
}
