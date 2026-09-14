package com.goatgank.voiceup;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "VoiceUpScreenShare")
public class VoiceUpScreenSharePlugin extends Plugin {
    private static WeakReference<VoiceUpScreenSharePlugin> current = new WeakReference<>(null);

    @Override
    public void load() {
        current = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        VoiceUpScreenSharePlugin plugin = current.get();
        if (plugin == this) current.clear();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (ScreenShareService.isRunning()) {
            call.reject("Já existe um compartilhamento de tela ativo.");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("O serviço de captura de tela não está disponível neste aparelho.");
            return;
        }
        Intent captureIntent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            captureIntent = manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay());
        } else {
            captureIntent = manager.createScreenCaptureIntent();
        }
        startActivityForResult(call, captureIntent, "screenCaptureResult");
    }

    @ActivityCallback
    private void screenCaptureResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("Compartilhamento de tela cancelado.", "SCREEN_CAPTURE_DENIED");
            return;
        }
        Intent service = new Intent(getContext(), ScreenShareService.class);
        service.setAction(ScreenShareService.ACTION_START);
        service.putExtra(ScreenShareService.EXTRA_RESULT_CODE, result.getResultCode());
        service.putExtra(ScreenShareService.EXTRA_RESULT_DATA, data);
        service.putExtra(ScreenShareService.EXTRA_WITH_AUDIO, call.getBoolean("withAudio", false));
        service.putExtra(ScreenShareService.EXTRA_MAX_DIMENSION, call.getInt("maxDimension", 720));
        service.putExtra(ScreenShareService.EXTRA_FRAME_RATE, call.getInt("frameRate", 10));
        try {
            ContextCompat.startForegroundService(getContext(), service);
            JSObject response = new JSObject();
            response.put("accepted", true);
            call.resolve(response);
        } catch (RuntimeException error) {
            call.reject("O Android não permitiu iniciar a captura de tela.", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!ScreenShareService.isRunning()) {
            call.resolve();
            return;
        }
        Intent service = new Intent(getContext(), ScreenShareService.class);
        service.setAction(ScreenShareService.ACTION_STOP);
        getContext().startService(service);
        call.resolve();
    }

    static void emitStarted(int width, int height, boolean audioEnabled, int sampleRate) {
        JSObject data = new JSObject();
        data.put("width", width);
        data.put("height", height);
        data.put("audioEnabled", audioEnabled);
        data.put("sampleRate", sampleRate);
        emit("screenStarted", data, false);
    }

    static void emitFrame(String frame, int width, int height) {
        JSObject data = new JSObject();
        data.put("data", frame);
        data.put("width", width);
        data.put("height", height);
        emit("screenFrame", data, false);
    }

    static void emitAudio(String audio, int sampleRate) {
        JSObject data = new JSObject();
        data.put("data", audio);
        data.put("sampleRate", sampleRate);
        emit("screenAudio", data, false);
    }

    static void emitWarning(String message) {
        JSObject data = new JSObject();
        data.put("message", message);
        emit("screenWarning", data, false);
    }

    static void emitStopped(String reason) {
        JSObject data = new JSObject();
        data.put("reason", reason);
        emit("screenStopped", data, false);
    }

    private static void emit(String event, JSObject data, boolean retain) {
        VoiceUpScreenSharePlugin plugin = current.get();
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> plugin.notifyListeners(event, data, retain));
    }
}
