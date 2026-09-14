package com.goatgank.voiceup;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

public class ScreenShareService extends Service {
    static final String ACTION_START = "com.goatgank.voiceup.action.START_SCREEN_SHARE";
    static final String ACTION_STOP = "com.goatgank.voiceup.action.STOP_SCREEN_SHARE";
    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_RESULT_DATA = "resultData";
    static final String EXTRA_WITH_AUDIO = "withAudio";
    static final String EXTRA_MAX_DIMENSION = "maxDimension";
    static final String EXTRA_FRAME_RATE = "frameRate";

    private static final String CHANNEL_ID = "voiceup_screen_share";
    private static final int NOTIFICATION_ID = 4071;
    private static final int AUDIO_SAMPLE_RATE = 48_000;
    private static volatile boolean active;

    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private DisplayManager displayManager;
    private HandlerThread imageThread;
    private Handler imageHandler;
    private AudioRecord audioRecord;
    private Thread audioThread;
    private boolean running;
    private int captureWidth;
    private int captureHeight;
    private int captureDensity;
    private int maxDimension = 720;
    private int frameRate = 10;
    private long lastFrameAt;

    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            terminate("O Android encerrou a captura de tela.", true);
        }
    };

    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int displayId) {}
        @Override public void onDisplayRemoved(int displayId) {}
        @Override public void onDisplayChanged(int displayId) {
            if (displayId == Display.DEFAULT_DISPLAY && imageHandler != null) imageHandler.post(ScreenShareService.this::resizeForCurrentDisplay);
        }
    };

    static boolean isRunning() {
        return active;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        imageThread = new HandlerThread("VoiceUP-ScreenFrames");
        imageThread.start();
        imageHandler = new Handler(imageThread.getLooper());
        displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            terminate("Compartilhamento de tela encerrado.", true);
            return START_NOT_STICKY;
        }
        if (intent == null || !ACTION_START.equals(intent.getAction()) || active) return START_NOT_STICKY;
        startProjectionForeground();
        try {
            beginProjection(intent);
        } catch (Exception error) {
            terminate("Não foi possível iniciar a captura de tela.", true);
        }
        return START_NOT_STICKY;
    }

    private void startProjectionForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void beginProjection(Intent intent) {
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultData == null) throw new IllegalStateException("Missing MediaProjection result");
        maxDimension = Math.max(360, Math.min(1080, intent.getIntExtra(EXTRA_MAX_DIMENSION, 720)));
        frameRate = Math.max(6, Math.min(15, intent.getIntExtra(EXTRA_FRAME_RATE, 10)));
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) throw new IllegalStateException("Missing MediaProjectionManager");
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) throw new IllegalStateException("Missing MediaProjection");
        projection.registerCallback(projectionCallback, mainHandler);
        running = true;
        active = true;
        updateCaptureSize();
        createImageReader();
        virtualDisplay = projection.createVirtualDisplay(
            "VoiceUP Full Screen",
            captureWidth,
            captureHeight,
            captureDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            imageHandler
        );
        if (virtualDisplay == null) throw new IllegalStateException("Virtual display was not created");
        if (displayManager != null) displayManager.registerDisplayListener(displayListener, mainHandler);
        boolean audioEnabled = intent.getBooleanExtra(EXTRA_WITH_AUDIO, false) && startAudioCapture();
        VoiceUpScreenSharePlugin.emitStarted(captureWidth, captureHeight, audioEnabled, AUDIO_SAMPLE_RATE);
    }

    private void updateCaptureSize() {
        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) throw new IllegalStateException("Missing WindowManager");
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        int rawWidth = Math.max(2, metrics.widthPixels);
        int rawHeight = Math.max(2, metrics.heightPixels);
        float scale = Math.min(1f, maxDimension / (float) Math.max(rawWidth, rawHeight));
        captureWidth = Math.max(2, Math.round(rawWidth * scale));
        captureHeight = Math.max(2, Math.round(rawHeight * scale));
        if ((captureWidth & 1) != 0) captureWidth -= 1;
        if ((captureHeight & 1) != 0) captureHeight -= 1;
        captureDensity = Math.max(DisplayMetrics.DENSITY_LOW, metrics.densityDpi);
    }

    private void createImageReader() {
        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(this::handleImage, imageHandler);
    }

    private void resizeForCurrentDisplay() {
        if (!running || stopping.get() || virtualDisplay == null) return;
        int oldWidth = captureWidth;
        int oldHeight = captureHeight;
        updateCaptureSize();
        if (oldWidth == captureWidth && oldHeight == captureHeight) return;
        ImageReader oldReader = imageReader;
        createImageReader();
        virtualDisplay.resize(captureWidth, captureHeight, captureDensity);
        virtualDisplay.setSurface(imageReader.getSurface());
        if (oldReader != null) {
            oldReader.setOnImageAvailableListener(null, null);
            oldReader.close();
        }
    }

    private void handleImage(ImageReader reader) {
        Image image = null;
        Bitmap padded = null;
        Bitmap cropped = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null || !running || stopping.get()) return;
            long now = System.nanoTime();
            long interval = 1_000_000_000L / Math.max(1, frameRate);
            if (now - lastFrameAt < interval) return;
            lastFrameAt = now;
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int frameWidth = reader.getWidth();
            int frameHeight = reader.getHeight();
            int paddedWidth = frameWidth + Math.max(0, rowStride - pixelStride * frameWidth) / pixelStride;
            padded = Bitmap.createBitmap(paddedWidth, frameHeight, Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buffer);
            cropped = Bitmap.createBitmap(padded, 0, 0, frameWidth, frameHeight);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!cropped.compress(Bitmap.CompressFormat.JPEG, maxDimension >= 720 ? 62 : 58, output)) return;
            String encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            VoiceUpScreenSharePlugin.emitFrame(encoded, frameWidth, frameHeight);
        } catch (RuntimeException error) {
            if (running && !stopping.get()) VoiceUpScreenSharePlugin.emitWarning("Um quadro da tela não pôde ser transmitido.");
        } finally {
            if (cropped != null && cropped != padded) cropped.recycle();
            if (padded != null) padded.recycle();
            if (image != null) image.close();
        }
    }

    private boolean startAudioCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false;
        try {
            AudioPlaybackCaptureConfiguration configuration = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .build();
            AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(AUDIO_SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build();
            int minimum = AudioRecord.getMinBufferSize(AUDIO_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufferSize = Math.max(19_200, minimum > 0 ? minimum * 2 : 0);
            audioRecord = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .setAudioPlaybackCaptureConfig(configuration)
                .build();
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release();
                audioRecord = null;
                return false;
            }
            audioRecord.startRecording();
            if (audioRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) return false;
            audioThread = new Thread(this::pumpAudio, "VoiceUP-ScreenAudio");
            audioThread.start();
            return true;
        } catch (RuntimeException error) {
            if (audioRecord != null) {
                audioRecord.release();
                audioRecord = null;
            }
            return false;
        }
    }

    private void pumpAudio() {
        byte[] buffer = new byte[9_600];
        while (running && !stopping.get() && audioRecord != null) {
            int read;
            try {
                read = audioRecord.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
            } catch (RuntimeException error) {
                break;
            }
            if (read > 1) {
                int evenLength = read - (read & 1);
                VoiceUpScreenSharePlugin.emitAudio(Base64.encodeToString(buffer, 0, evenLength, Base64.NO_WRAP), AUDIO_SAMPLE_RATE);
            }
        }
    }

    private void terminate(String reason, boolean stopService) {
        if (!stopping.compareAndSet(false, true)) return;
        active = false;
        running = false;
        if (displayManager != null) {
            try { displayManager.unregisterDisplayListener(displayListener); } catch (RuntimeException ignored) {}
        }
        if (audioRecord != null) {
            try { audioRecord.stop(); } catch (RuntimeException ignored) {}
        }
        if (audioThread != null) {
            try { audioThread.join(400); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            audioThread = null;
        }
        if (audioRecord != null) {
            audioRecord.release();
            audioRecord = null;
        }
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.setOnImageAvailableListener(null, null);
            imageReader.close();
            imageReader = null;
        }
        if (projection != null) {
            try { projection.unregisterCallback(projectionCallback); } catch (RuntimeException ignored) {}
            try { projection.stop(); } catch (RuntimeException ignored) {}
            projection = null;
        }
        VoiceUpScreenSharePlugin.emitStopped(reason);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        if (stopService) stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Compartilhamento de tela", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantém a transmissão da tela do VoiceUP visível e sob seu controle.");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, ScreenShareService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 71, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_screen_share)
            .setContentTitle("VoiceUP está compartilhando sua tela")
            .setContentText("Toque em Parar para encerrar a transmissão.")
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(R.drawable.ic_screen_share, "Parar", stopAction)
            .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        terminate("O VoiceUP foi fechado e encerrou o compartilhamento.", true);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        terminate("O serviço de compartilhamento foi encerrado.", false);
        if (imageThread != null) imageThread.quitSafely();
        imageThread = null;
        imageHandler = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
