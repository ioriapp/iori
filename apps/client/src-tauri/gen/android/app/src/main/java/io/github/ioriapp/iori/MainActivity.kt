package io.github.ioriapp.iori

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The system-bar and cutout insets are applied by IoriNativePlugin.load.
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
