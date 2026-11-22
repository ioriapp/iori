package io.github.ioriapp.iori

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class IoriKeystore(private val activity: Activity) {
  private val preferences by lazy {
    activity.getSharedPreferences("iori_identity", Context.MODE_PRIVATE)
  }

  fun protectView(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ViewArgs::class.java)
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        ?: error("The Android storage key is unavailable")
      val plaintext = args.value.toByteArray(Charsets.UTF_8)
      try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
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

  fun unprotectView(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ViewArgs::class.java)
      val packed = args.value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val key = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        ?: error("The view storage key is unavailable")
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, packed.copyOfRange(0, GCM_IV_BYTES)))
      val plaintext = cipher.doFinal(packed.copyOfRange(GCM_IV_BYTES, packed.size))
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

  fun getIdentity(invoke: Invoke) {
    try {
      val secretHex = loadOrCreateSecretHex()
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

  private fun loadOrCreateSecretHex(): String {
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
    const val KEY_ALIAS = "io.github.ioriapp.iori.identity.v1"
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
