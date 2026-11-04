package io.github.ioriapp.iori.clipboardimage

import android.app.Activity
import android.content.ClipboardManager
import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import kotlin.concurrent.thread

@TauriPlugin
class ClipboardImagePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun readContent(invoke: Invoke) {
        try {
            val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = manager.primaryClip
            val item = if (clip != null && clip.itemCount > 0) clip.getItemAt(0) else null
            // Do not coerce a URI to text: an image URI belongs to the image path.
            val text = item?.text?.toString()
            if (!text.isNullOrEmpty()) {
                invoke.resolve(JSObject().put("text", text))
                return
            }
            val uri = item?.uri
            if (uri == null || uri.scheme != "content") {
                invoke.resolve(JSObject().put("text", ""))
                return
            }
            // Keep the clip read on the foreground Activity, but read images off the UI thread.
            // ClipboardManager grants temporary access to the copied content URI.
            thread {
                try {
                    val resolver = activity.contentResolver
                    val mime = resolver.getType(uri)
                    if (mime?.startsWith("image/") != true) {
                        invoke.resolve(JSObject().put("text", ""))
                        return@thread
                    }
                    val bytes = when (mime) {
                        "image/png", "image/jpeg", "image/webp", "image/gif" ->
                            resolver.openInputStream(uri)?.use { it.readBytes() }
                                ?: throw IllegalStateException("Could not read clipboard image")
                        else -> readPng(resolver, uri)
                    }
                    invoke.resolve(JSObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
                } catch (error: Throwable) {
                    // A large image can exhaust the heap; report it instead of
                    // letting the uncaught Error end the Client process.
                    invoke.reject(error.message ?: error.javaClass.simpleName)
                }
            }
        } catch (error: Exception) {
            invoke.reject(error.message ?: error.javaClass.simpleName)
        }
    }

    private fun readPng(resolver: ContentResolver, uri: Uri): ByteArray {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
            inSampleSize = 1
        }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        // Limit decoded bitmap memory for formats that must be converted.
        val longest = maxOf(options.outWidth, options.outHeight).toLong()
        while (longest > 4096L * options.inSampleSize) options.inSampleSize *= 2
        options.inJustDecodeBounds = false
        val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: throw IllegalStateException("Could not decode clipboard image")
        try {
            return ByteArrayOutputStream().use { output ->
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                    throw IllegalStateException("Could not encode clipboard image")
                }
                output.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }
    }
}
