package io.github.ioriapp.iori

import android.app.Activity
import android.content.Intent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.provider.DocumentsContract
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val STORAGE_KEY_ALIAS = "io.github.ioriapp.iori.identity.v1"

@InvokeArg
class ViewArgs {
  lateinit var value: String
}

@InvokeArg
class BackgroundConnectionArgs { var enabled: Boolean = false; var title: String = "iori"; var body: String = "" }

@TauriPlugin
class IoriNativePlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null

  override fun load(webView: WebView) {
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

  // The terminal turns a finger tap into its own gesture and cancels the touch,
  // so the WebView never shows the keyboard for the focus a tap gives it.
  @Command
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
  @Command
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

  @Command
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

  @Command
  fun defaultBack(invoke: Invoke) {
    activity.runOnUiThread {
      (activity as AppCompatActivity).onBackPressedDispatcher.onBackPressed()
      invoke.resolve(JSObject())
    }
  }

  @Command
  fun protectView(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ViewArgs::class.java)
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = keyStore.getKey(STORAGE_KEY_ALIAS, null) as? SecretKey
        ?: error("The Android storage key is unavailable")
      val plaintext = args.value.toByteArray(Charsets.UTF_8)
      try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val packed = cipher.iv + cipher.doFinal(plaintext)
        invoke.resolve(JSObject().put("value", packed.toHex()))
      } finally {
        plaintext.fill(0)
      }
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not save the view")
    }
  }

  @Command
  fun unprotectView(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ViewArgs::class.java)
      val packed = args.value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = keyStore.getKey(STORAGE_KEY_ALIAS, null) as? SecretKey
        ?: error("The view storage key is unavailable")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, packed.copyOfRange(0, 12)))
      val plaintext = cipher.doFinal(packed.copyOfRange(12, packed.size))
      try {
        invoke.resolve(JSObject().put("value", plaintext.toString(Charsets.UTF_8)))
      } finally {
        plaintext.fill(0)
        packed.fill(0)
      }
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not load the view")
    }
  }

  @Command
  fun getIdentity(invoke: Invoke) {
    try {
      val secretHex = AndroidIdentity(activity).loadOrCreateSecretHex()
      val deviceName = Settings.Global.getString(activity.contentResolver, "device_name")
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: Build.MODEL
        ?: "Android"
      val locale = activity.resources.configuration.locales[0]
      val language = locale.toLanguageTag().ifBlank { "en-US" }
      val canScanQr = activity.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

      invoke.resolve(
        JSObject()
          .put("secretHex", secretHex)
          .put("deviceName", deviceName)
          .put("language", language)
          .put("canScanQr", canScanQr),
      )
    } catch (error: Exception) {
      invoke.reject(error.message ?: "Could not load the Android identity")
    }
  }

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

private class AndroidIdentity(private val context: Context) {
  private val preferences by lazy {
    context.getSharedPreferences("iori_identity", Context.MODE_PRIVATE)
  }

  fun loadOrCreateSecretHex(): String {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val stored = preferences.getString(SECRET_KEY, null)
    if (stored != null) {
      val key = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        ?: error("The Android identity key is unavailable")
      val packed = Base64.decode(stored, Base64.NO_WRAP)
      if (packed.size <= GCM_IV_BYTES) error("The stored Android identity is invalid")
      val iv = packed.copyOfRange(0, GCM_IV_BYTES)
      val ciphertext = packed.copyOfRange(GCM_IV_BYTES, packed.size)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
      val plaintext = cipher.doFinal(ciphertext)
      if (plaintext.size != SECRET_BYTES) {
        plaintext.fill(0)
        error("The stored Android identity has an invalid length")
      }
      return try {
        plaintext.toHex()
      } finally {
        plaintext.fill(0)
        packed.fill(0)
      }
    }

    if (keyStore.containsAlias(KEY_ALIAS)) {
      error("The Android identity data is missing; it was not replaced")
    }

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    keyGenerator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    val key = keyGenerator.generateKey()
    val plaintext = ByteArray(SECRET_BYTES).also(SecureRandom()::nextBytes)
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key)
      val ciphertext = cipher.doFinal(plaintext)
      val packed = cipher.iv + ciphertext
      val encoded = Base64.encodeToString(packed, Base64.NO_WRAP)
      if (!preferences.edit().putString(SECRET_KEY, encoded).commit()) {
        keyStore.deleteEntry(KEY_ALIAS)
        error("Could not save the Android identity")
      }
      plaintext.toHex()
    } finally {
      plaintext.fill(0)
    }
  }

  private companion object {
    const val KEY_ALIAS = STORAGE_KEY_ALIAS
    const val SECRET_KEY = "secret_ciphertext"
    const val SECRET_BYTES = 32
    const val GCM_IV_BYTES = 12
    const val GCM_TAG_BITS = 128
    const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}

private fun ByteArray.toHex(): String {
  val digits = "0123456789abcdef"
  val output = CharArray(size * 2)
  forEachIndexed { index, byte ->
    val value = byte.toInt() and 0xff
    output[index * 2] = digits[value ushr 4]
    output[index * 2 + 1] = digits[value and 0x0f]
  }
  return String(output)
}
