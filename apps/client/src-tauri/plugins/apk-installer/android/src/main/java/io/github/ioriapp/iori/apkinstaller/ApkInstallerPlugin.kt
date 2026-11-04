package io.github.ioriapp.iori.apkinstaller

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import kotlin.concurrent.thread

@InvokeArg
internal class InstallApkArgs {
    lateinit var path: String
    lateinit var onConfirmation: Channel
}

@TauriPlugin
class ApkInstallerPlugin(private val activity: Activity) : Plugin(activity) {
    private var foreground = false

    override fun onResume(activity: AppCompatActivity) {
        foreground = true
    }

    override fun onPause(activity: AppCompatActivity) {
        foreground = false
    }

    override fun onNewIntent(intent: Intent) {
        // singleTask removes the confirmation above us when a launcher or
        // notification opens this Activity again. Ordinary resume does not.
        for (request in InstallResultReceiver.pending.values) {
            if (request.confirmation != null) request.onConfirmation.sendObject(true)
        }
    }

    @Command
    fun resumeInstallation(invoke: Invoke) {
        // SessionInfo does not expose whether the user has already answered.
        // Only an explicit user action may reopen the retained OS confirmation.
        try {
            for ((id, request) in InstallResultReceiver.pending) {
                if (activity.packageManager.packageInstaller.getSessionInfo(id) == null) {
                    InstallResultReceiver.pending.remove(id)
                    request.callback.cancel()
                    request.invoke.resolve(JSObject().put("status", "cancelled"))
                    continue
                }
                request.openConfirmation()
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: error.javaClass.simpleName)
        }
    }

    @Command
    fun canRequestPackageInstalls(invoke: Invoke) {
        // Before Android 8 this permission was a system-wide setting.
        val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            activity.packageManager.canRequestPackageInstalls()
        invoke.resolve(JSObject().put("allowed", allowed))
    }

    @Command
    fun openInstallPermissionSettings(invoke: Invoke) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startActivity(Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                ))
            }
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject(error.message ?: error.javaClass.simpleName)
        }
    }

    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(InstallApkArgs::class.java)
        // Native commands enter on the UI thread; APK IO must not block it.
        thread(name = "iori-apk-install") {
            val installer = activity.packageManager.packageInstaller
            var sessionId: Int? = null
            var callback: PendingIntent? = null
            try {
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
                }
                val id = installer.createSession(params)
                sessionId = id
                installer.openSession(id).use { session ->
                    File(args.path).inputStream().use { input ->
                        session.openWrite("base.apk", 0, -1).use { output ->
                            input.copyTo(output)
                            session.fsync(output)
                        }
                    }
                    val intent = Intent(activity, InstallResultReceiver::class.java)
                        .setAction("${activity.packageName}.APK_INSTALL_RESULT")
                        .setData(Uri.parse("iori-apk-install:$id"))
                    // PackageInstaller supplies result extras, so this explicit,
                    // non-exported receiver needs a mutable PendingIntent.
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                    val pending = PendingIntent.getBroadcast(activity, id, intent, flags)
                    callback = pending
                    InstallResultReceiver.pending[id] = PendingInstall(activity, invoke, pending, args.onConfirmation, { foreground })
                    session.commit(pending.intentSender)
                }
            } catch (error: Exception) {
                sessionId?.let { id ->
                    InstallResultReceiver.pending.remove(id)
                    try {
                        installer.abandonSession(id)
                    } catch (cleanupError: Exception) {
                        error.addSuppressed(cleanupError)
                    }
                }
                callback?.cancel()
                invoke.resolve(failed(error.message ?: error.javaClass.simpleName))
            }
        }
    }
}

internal fun failed(reason: String): JSObject =
    JSObject().put("status", "failed").put("reason", reason)
