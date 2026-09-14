package com.goatgank.voiceup;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VoiceUpUpdater")
public class VoiceUpUpdaterPlugin extends Plugin {
    private static final String DOWNLOAD_HOST = "voiceup.shardweb.app";
    private static final String DOWNLOAD_PATH = "/downloads/android";

    private String channel() {
        return BuildConfig.DISTRIBUTION_CHANNEL;
    }

    @PluginMethod
    public void getChannel(PluginCall call) {
        JSObject result = new JSObject();
        result.put("channel", channel());
        call.resolve(result);
    }

    @PluginMethod
    public void openDownload(PluginCall call) {
        if ("play".equals(channel())) {
            call.reject("Esta edição recebe atualizações somente pela Play Store.");
            return;
        }
        Uri uri = Uri.parse(call.getString("url", ""));
        boolean trusted = "https".equalsIgnoreCase(uri.getScheme())
            && DOWNLOAD_HOST.equalsIgnoreCase(uri.getHost())
            && DOWNLOAD_PATH.equals(uri.getPath())
            && uri.getPort() == -1
            && uri.getQuery() == null
            && uri.getFragment() == null;
        if (!trusted) {
            call.reject("O endereço de atualização não pertence ao site oficial do VoiceUP.");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("Nenhum navegador foi encontrado para baixar o APK.", error);
        }
    }
}
