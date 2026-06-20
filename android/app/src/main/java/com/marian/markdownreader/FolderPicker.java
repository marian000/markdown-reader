package com.marian.markdownreader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

@CapacitorPlugin(name = "FolderPicker")
public class FolderPicker extends Plugin {

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderResult");
    }

    @ActivityCallback
    private void folderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri treeUri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                    treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}

        try {
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), treeUri);
            if (root == null) { call.reject("cannot open folder"); return; }
            JSArray items = new JSArray();
            String base = root.getName() != null ? root.getName() : "folder";
            walk(root, base, items);
            JSObject ret = new JSObject();
            ret.put("root", base);
            ret.put("uri", treeUri.toString());
            ret.put("items", items);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read error: " + e.getMessage());
        }
    }

    private void walk(DocumentFile dir, String rel, JSArray items) {
        DocumentFile[] children = dir.listFiles();
        for (DocumentFile f : children) {
            String name = f.getName();
            if (name == null) continue;
            if (f.isDirectory()) {
                if (name.startsWith(".")) continue;
                walk(f, rel + "/" + name, items);
                continue;
            }
            String lower = name.toLowerCase(Locale.ROOT);
            boolean isMd = lower.matches(".*\\.(md|markdown|mdown|mkd|txt)$");
            boolean isImg = lower.matches(".*\\.(png|jpe?g|gif|svg|webp|bmp|avif)$");
            if (!isMd && !isImg) continue;
            byte[] data = readAll(f.getUri());
            if (data == null) continue;
            JSObject item = new JSObject();
            item.put("path", rel + "/" + name);
            if (isMd) {
                item.put("kind", "md");
                item.put("text", new String(data, java.nio.charset.StandardCharsets.UTF_8));
            } else {
                item.put("kind", "img");
                item.put("mime", mimeFor(lower));
                item.put("base64", Base64.encodeToString(data, Base64.NO_WRAP));
            }
            items.put(item);
        }
    }

    private byte[] readAll(Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private String mimeFor(String lower) {
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".avif")) return "image/avif";
        return "application/octet-stream";
    }
}
