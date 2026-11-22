package cc.hai.nineremote;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// One full-screen WebView on the 9Remote web app. The hardware Back key is handled here, not
// by browser history, so the exit prompt works even before the user has touched the page.
public class MainActivity extends Activity {
    // Must match web/shared/lib/nativeShell.js.
    private static final String SHELL_BRIDGE = "NineRemoteShell";
    private static final String BACK_HOOK_JS =
            "(function(c){var f=window.__nineRemoteShellBack;return f?f(c):''})(%s)";
    private static final String BACK_HANDLED = "\"handled\"";
    private static final String BACK_EXIT = "\"exit\"";

    private static final int FILE_REQUEST = 1;
    private static final int MIC_REQUEST = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMic;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Personal sideloaded build: allow chrome://inspect over ADB.
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), SHELL_BRIDGE);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String scheme = req.getUrl().getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                openExternal(req.getUrl());
                return true;
            }
        });
        web.setWebChromeClient(new ChromeClient());
        setContentView(web);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(BuildConfig.START_URL);
    }

    // targetSdk 34 without enableOnBackInvokedCallback: the system still routes Back here.
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    // The page decides first: on the root view it opens its exit popup (or exits when that is
    // already up); elsewhere it walks web history, or steps up itself when there is none.
    private void handleBack() {
        String js = String.format(BACK_HOOK_JS, web.canGoBack());
        web.evaluateJavascript(js, (answer) -> {
            if (BACK_HANDLED.equals(answer)) return;
            if (BACK_EXIT.equals(answer)) { finish(); return; }
            if (web.canGoBack()) web.goBack();
            else confirmExit();
        });
    }

    // Fallback for pages without the hook (login, a page still loading).
    private void confirmExit() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.exit_title)
                .setMessage(R.string.exit_message)
                .setPositiveButton(R.string.exit_confirm, (d, w) -> finish())
                .setNegativeButton(R.string.exit_stay, null)
                .show();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // No app handles this scheme: nothing to open.
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MIC_REQUEST || pendingMic == null) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) pendingMic.grant(pendingMic.getResources());
        else pendingMic.deny();
        pendingMic = null;
    }

    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_REQUEST);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                    return;
                }
                pendingMic = request;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
            });
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finish);
        }
    }
}
