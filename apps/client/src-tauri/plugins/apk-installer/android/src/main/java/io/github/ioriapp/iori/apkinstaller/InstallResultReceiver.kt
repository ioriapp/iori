package io.github.ioriapp.iori.apkinstaller

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import androidx.core.content.IntentCompat
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.util.concurrent.ConcurrentHashMap

internal data class PendingInstall(
    val activity: Activity,
    val invoke: Invoke,
    val callback: PendingIntent,
    val onConfirmation: Channel,
    val isForeground: () -> Boolean,
    var confirmation: Intent? = null,
) {
    fun openConfirmation() {
        val intent = confirmation ?: return
        // A background start may be silently blocked. A foreground start
        // consumes the recovery action before returning from the OS dialog.
        onConfirmation.sendObject(!isForeground())
        try {
            activity.startActivity(intent)
        } catch (error: Exception) {
            onConfirmation.sendObject(true)
            throw error
        }
    }
}

class InstallResultReceiver : BroadcastReceiver() {
    companion object {
        internal val pending = ConcurrentHashMap<Int, PendingInstall>()
    }

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.data?.schemeSpecificPart?.toIntOrNull() ?: return
        val request = pending[id] ?: return
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                try {
                    val confirmation = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                        ?: throw IllegalStateException("Android did not provide installation confirmation")
                    // Retain it if a background launch is blocked, or singleTask
                    // later removes the installer above our Activity.
                    request.confirmation = confirmation
                    request.openConfirmation()
                } catch (error: Exception) {
                    pending.remove(id)
                    request.callback.cancel()
                    try {
                        context.packageManager.packageInstaller.abandonSession(id)
                    } catch (cleanupError: Exception) {
                        error.addSuppressed(cleanupError)
                    }
                    request.invoke.resolve(failed(error.message ?: error.javaClass.simpleName))
                }
            }
            else -> {
                pending.remove(id)
                request.callback.cancel()
                when (status) {
                    PackageInstaller.STATUS_SUCCESS -> request.invoke.resolve(JSObject().put("status", "installed"))
                    PackageInstaller.STATUS_FAILURE_ABORTED -> request.invoke.resolve(JSObject().put("status", "cancelled"))
                    else -> request.invoke.resolve(failed(
                        intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                            ?: "Android installation failed (status $status)"
                    ))
                }
            }
        }
    }
}
