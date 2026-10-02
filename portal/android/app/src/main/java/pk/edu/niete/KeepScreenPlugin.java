package pk.edu.niete;

import android.app.Activity;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * bd-q4g7s: keep the screen on while a teacher records her lesson.
 *
 * A lesson is 30-40 minutes and the phone sits on the table, so the screen
 * would time out within a minute or two. When it does, Android pauses the app
 * and a backgrounded app gets silence from the microphone: the rest of the
 * lesson would be recorded as nothing. The web Screen Wake Lock API is not a
 * dependable answer inside every Android WebView, so the app does it natively.
 *
 * The web side (portal/src/portal/lib/keepAwake.ts) calls on() when recording
 * starts and off() when it stops, and falls back to navigator.wakeLock in a
 * browser or an older app build without this plugin.
 */
@CapacitorPlugin(name = "KeepScreen")
public class KeepScreenPlugin extends Plugin {

    @PluginMethod
    public void on(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void off(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
