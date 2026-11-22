package io.github.ioriapp.iori.clipboardimage

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import kotlin.concurrent.thread

private const val MAX_IMAGE_BYTES = 20 * 1024 * 1024
private const val IMAGE_TOO_LARGE = "Clipboard image exceeds the 20 MiB limit"

private class ImageBuffer : ByteArrayOutputStream() {
    var tooLarge = false
        private set

    fun toBase64(): String = Base64.encodeToString(buf, 0, size(), Base64.NO_WRAP)

    fun decode(options: BitmapFactory.Options): Bitmap? =
        BitmapFactory.decodeByteArray(buf, 0, size(), options)

    private fun checkSize(length: Int) {
        if (length > MAX_IMAGE_BYTES - size()) {
            tooLarge = true
            throw IOException(IMAGE_TOO_LARGE)
        }
    }

    override fun write(value: Int) {
        checkSize(1)
        super.write(value)
    }

    override fun write(bytes: ByteArray, offset: Int, length: Int) {
        checkSize(length)
        super.write(bytes, offset, length)
    }
}

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
                    val source = resolver.openInputStream(uri)?.use { readImage(it) }
                        ?: throw IllegalStateException("Could not read clipboard image")
                    val image = when (mime) {
                        "image/png", "image/jpeg", "image/webp", "image/gif" -> source
                        else -> readPng(source)
                    }
                    invoke.resolve(JSObject().put("data", image.toBase64()))
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

    private fun readImage(input: InputStream): ImageBuffer {
        val output = ImageBuffer()
        val chunk = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = input.read(chunk, 0, minOf(chunk.size, MAX_IMAGE_BYTES - output.size() + 1))
            if (count < 0) return output
            output.write(chunk, 0, count)
        }
    }

    private fun readPng(source: ImageBuffer): ImageBuffer {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
            inSampleSize = 1
        }
        source.decode(options)
        // Limit decoded bitmap memory for formats that must be converted.
        val longest = maxOf(options.outWidth, options.outHeight).toLong()
        while (longest > 4096L * options.inSampleSize) options.inSampleSize *= 2
        options.inJustDecodeBounds = false
        val bitmap = source.decode(options)
            ?: throw IllegalStateException("Could not decode clipboard image")
        try {
            val output = ImageBuffer()
            val encoded = bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            // Some encoders report a stream write failure through their return value.
            if (output.tooLarge) throw IOException(IMAGE_TOO_LARGE)
            if (!encoded) throw IllegalStateException("Could not encode clipboard image")
            return output
        } finally {
            bitmap.recycle()
        }
    }
}
