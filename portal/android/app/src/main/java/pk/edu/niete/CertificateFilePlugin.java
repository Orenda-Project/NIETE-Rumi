package pk.edu.niete;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * bd-4ryvw: save a training certificate inside the app instead of handing it to Chrome.
 *
 * The portal's download route 302s to a signed R2 url. In the WebView that navigation goes
 * to R2's host, which is not the app's own, so Capacitor gives it to Android and the teacher
 * lands in Chrome. The web side (portal/src/portal/newui/training/certificateFile.ts) now
 * asks the portal for the signed link and calls save({ url, filename }) here.
 *
 * The signed url is its own credential, so no session cookie is sent anywhere. The PDF is
 * written to the app's cache, copied to Downloads on Android 10+ (MediaStore, which needs no
 * permission), and opened in the phone's PDF viewer through the FileProvider. Android 7-9
 * would need WRITE_EXTERNAL_STORAGE for Downloads, which the app deliberately does not
 * declare (bd-q4g7s.1), so there the file is only opened; the viewer can save or share it.
 */
@CapacitorPlugin(name = "CertificateFile")
public class CertificateFilePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String url = call.getString("url");
        String filename = safeName(call.getString("filename"));
        if (url == null || !"https".equals(Uri.parse(url).getScheme())) {
            call.reject("An https url is required");
            return;
        }

        new Thread(() -> {
            try {
                Context context = getContext();
                File dir = new File(context.getCacheDir(), "certificates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create the cache folder");
                File file = new File(dir, filename);
                download(url, file);

                boolean saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && saveToDownloads(context, file, filename);
                boolean opened = open(file);

                JSObject result = new JSObject();
                result.put("saved", saved);
                result.put("opened", opened);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not save the certificate", e);
            }
        }).start();
    }

    private static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (clean.isEmpty()) clean = "NIETE-certificate";
        return clean.toLowerCase().endsWith(".pdf") ? clean : clean + ".pdf";
    }

    private static void download(String url, File into) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(60_000);
        try {
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) throw new Exception("HTTP " + status);
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(into)) {
                copy(in, out);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static boolean saveToDownloads(Context context, File file, String filename) {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        Uri item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (item == null) return false;
        try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) return false;
            copy(in, out);
            return true;
        } catch (Exception e) {
            resolver.delete(item, null, null);
            return false;
        }
    }

    private boolean open(File file) {
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(uri, "application/pdf");
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(view);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
    }
}
