package expo.modules.securewindow

import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * FLAG_SECURE on SoulSync's window, and nothing else: no screenshots, no screen
 * recording, no app-switcher preview while it is set. The app lock sets it while
 * a PIN is set (context/AppLock.tsx). Why this module and not a package:
 * frontend/modules/secure-window/README.md.
 */
class SecureWindowModule : Module() {
  // The state JS asked for, re-applied when the activity comes back (a
  // recreated activity starts with a fresh window, without the flag).
  private var secure = false

  override fun definition() = ModuleDefinition {
    Name("SecureWindow")

    AsyncFunction("setSecure") { value: Boolean ->
      secure = value
      applyFlag()
    }

    OnActivityEntersForeground {
      applyFlag()
    }
  }

  // Window flags may only be changed on the UI thread. The call arrives on the
  // JS thread (`runOnQueue(Queues.MAIN)` did not move it there: the app aborted
  // on launch with "Only the original thread that created a view hierarchy can
  // touch its views ... Calling: mqt_v_js"), so hop explicitly.
  private fun applyFlag() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      if (secure) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
  }
}
