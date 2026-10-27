package app.aquamd.player;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;

/**
 * Aqua MD for Android: a full-screen WebView running the same deck as the desktop app (assets/www, built by
 * tools/build-web.js), plus the phone-only parts the page can't do itself: picking songs, opening the browser
 * for the Spotify login and taking the answer back, opening the Spotify app, the Back button, full screen,
 * keeping the screen on, and a playback notification so your own music keeps playing in the background.
 */
public class MainActivity extends Activity {
    private static final String TAG = "AquaMD";
    /** Address the bundled page is served from (reserved by Android for exactly this; never hits the network). */
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST + "/";
    private static final int PICK_FILES = 41;

    private static WeakReference<MainActivity> current = new WeakReference<MainActivity>(null);
    /** A Spotify login answer that arrived while no deck was open. */
    private static String loginWaiting = null;
    private String lastAuth = null;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** Brings the deck back in front after Spotify has had a moment to start. */
    private final Runnable comeBack = new Runnable() {
        @Override public void run() {
            Intent back = new Intent(MainActivity.this, MainActivity.class);
            back.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try { startActivity(back); } catch (Exception e) { Log.w(TAG, "couldn't come back: " + e); }
        }
    };

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private boolean pageReady = false;
    private String pendingAuth = null;
    private boolean fullscreen = false;
    private boolean askedNotifications = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<MainActivity>(this);
        Window w = getWindow();
        w.setStatusBarColor(0xFF070C17);
        w.setNavigationBarColor(0xFF070C17);

        WebView.setWebContentsDebuggingEnabled(true); // lets a USB-connected computer inspect the page while in beta
        web = new WebView(this);
        web.setBackgroundColor(0xFF070C17);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " AquaMD/" + versionName());
        keepRendererImportant();

        web.addJavascriptInterface(new Bridge(), "AquaAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return asset(u.getPath());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                openOutside(u); // anything else (links, Spotify pages) opens outside the deck
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingAuth != null) { String q = pendingAuth; pendingAuth = null; deliverAuth(q); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "audio/*", "video/*" });
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(i, PICK_FILES);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.w(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        setContentView(web);
        handleIntent(getIntent());
        if (loginWaiting != null) { String q = loginWaiting; loginWaiting = null; deliverAuth(q); }
        web.loadUrl(ORIGIN + "index.html");
    }

    /* ---------- the bundled page ---------- */
    private WebResourceResponse asset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in = getAssets().open("www" + path);
            String mime = mimeOf(path);
            WebResourceResponse r = new WebResourceResponse(mime, mime.startsWith("text/") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<String, String>();
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), null);
    }

    private static String mimeOf(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    /* ---------- intents: Spotify login answer, notification buttons ---------- */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri u = intent.getData();
        if (u != null && "aquamd".equals(u.getScheme()) && "callback".equals(u.getHost())) {
            String q = u.getEncodedQuery();
            deliverAuth(q == null ? "" : q);
            intent.setData(null);
        }
    }

    /** From LoginService: the browser came back to 127.0.0.1:43821/callback. */
    static void receiveLogin(String query) {
        MainActivity a = current.get();
        if (a != null && a.web != null) a.deliverAuth(query);
        else loginWaiting = query;
    }

    private void deliverAuth(String query) {
        if (query.equals(lastAuth)) return; // the same answer can arrive twice (local receiver + "Back to Aqua MD")
        if (!pageReady) { pendingAuth = query; return; }
        lastAuth = query;
        js("window.__aquaNative && window.__aquaNative.authCallback(" + JSONObject.quote(query) + ")");
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override public void run() { if (web != null) web.evaluateJavascript(code, null); }
        });
    }

    /** Play/pause/next/previous from the notification. */
    static void media(String cmd) {
        MainActivity a = current.get();
        if (a != null && cmd != null && cmd.matches("[a-z]+")) a.js("window.__aquaNative && window.__aquaNative.media('" + cmd + "')");
    }

    /* ---------- picking songs ---------- */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILES) { super.onActivityResult(requestCode, resultCode, data); return; }
        if (fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < result.length; i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    /* ---------- Back, full screen, lifecycle ---------- */
    @Override
    public void onBackPressed() {
        if (!pageReady) { moveTaskToBack(true); return; }
        web.evaluateJavascript("(window.__aquaNative && window.__aquaNative.back()) ? 'closed' : 'no'", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) {
                // Nothing left to close: go to the home screen but keep playing, like other music apps.
                if (v == null || !v.contains("closed")) moveTaskToBack(true);
            }
        });
    }

    void applyFullscreen(boolean on) {
        fullscreen = on;
        View d = getWindow().getDecorView();
        if (on) {
            d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        } else {
            d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreen) applyFullscreen(true);
    }

    @Override
    protected void onDestroy() {
        PlaybackService.update(this, "off", "", "");
        if (web != null) { web.removeJavascriptInterface("AquaAndroid"); web.destroy(); web = null; }
        super.onDestroy();
    }

    /** Keep the page running at normal priority while the screen is off (Android 8+, called by name). */
    private void keepRendererImportant() {
        try {
            WebView.class.getMethod("setRendererPriorityPolicy", int.class, boolean.class).invoke(web, 2, false);
        } catch (Exception e) { /* older WebView */ }
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (PackageManager.NameNotFoundException e) { return "0"; }
    }

    private void openOutside(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) { Log.w(TAG, "nothing can open " + u); }
    }

    private void askForNotifications() {
        if (askedNotifications || Build.VERSION.SDK_INT < 33) return;
        askedNotifications = true;
        String perm = "android.permission.POST_NOTIFICATIONS"; // Android 13+, newer than the SDK this compiles against
        if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[] { perm }, 7);
    }

    /* ---------- what the page can ask the phone for (window.AquaAndroid) ---------- */
    private class Bridge {
        @JavascriptInterface
        public String version() { return versionName(); }

        /** Names this phone may have in Spotify's device list (Spotify on Android uses the phone's name). */
        @JavascriptInterface
        public String deviceNames() {
            org.json.JSONArray a = new org.json.JSONArray();
            try { String n = android.provider.Settings.Global.getString(getContentResolver(), "device_name"); if (n != null) a.put(n); } catch (Exception e) { /* not set */ }
            try { String n = android.provider.Settings.Secure.getString(getContentResolver(), "bluetooth_name"); if (n != null) a.put(n); } catch (Exception e) { /* not readable */ }
            a.put(android.os.Build.MODEL);
            a.put(android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            return a.toString();
        }

        @JavascriptInterface
        public void startLogin(String url) {
            if (url == null || !url.startsWith("https://")) return;
            LoginService.start(MainActivity.this);
            openOutside(Uri.parse(url));
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null || !url.startsWith("https://")) return;
            openOutside(Uri.parse(url));
        }

        @JavascriptInterface
        public boolean openSpotify(String uri) {
            String target = uri != null && uri.matches("spotify:(playlist|album|artist|show):[A-Za-z0-9]+") ? uri : "spotify:";
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
            i.setPackage("com.spotify.music");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // Spotify has to be running on the phone before it can play. Start it, then come straight back to the
            // deck; Spotify keeps running behind it and Aqua MD tells it what to play.
            try {
                startActivity(i);
                main.removeCallbacks(comeBack);
                main.postDelayed(comeBack, 1300);
                return true;
            } catch (ActivityNotFoundException e) {
                Intent launch = getPackageManager().getLaunchIntentForPackage("com.spotify.music");
                if (launch != null) { startActivity(launch); main.removeCallbacks(comeBack); main.postDelayed(comeBack, 1300); return true; }
                openOutside(Uri.parse("https://play.google.com/store/apps/details?id=com.spotify.music"));
                return false;
            }
        }

        @JavascriptInterface
        public void setFullscreen(final boolean on) {
            runOnUiThread(new Runnable() { @Override public void run() { applyFullscreen(on); } });
        }

        @JavascriptInterface
        public void setKeepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Aqua MD", text == null ? "" : text));
                }
            });
        }

        @JavascriptInterface
        public void nowPlaying(String json) {
            try {
                JSONObject o = new JSONObject(json);
                final String state = !o.optBoolean("local") ? "off" : (o.optBoolean("playing") ? "playing" : "paused");
                final String title = o.optString("title", ""), artist = o.optString("artist", "");
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if ("playing".equals(state)) askForNotifications();
                        PlaybackService.update(MainActivity.this, state, title, artist);
                    }
                });
            } catch (Exception e) { Log.w(TAG, "nowPlaying: " + e); }
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() { @Override public void run() { moveTaskToBack(true); } });
        }
    }
}
