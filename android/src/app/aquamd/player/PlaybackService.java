package app.aquamd.player;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

/**
 * Runs while Aqua MD plays your own music, so it keeps playing with the screen off or another app open.
 * Shows a notification with previous / pause / next. Spotify doesn't need this: it plays in the Spotify app.
 * (Android 8+ APIs are called by name because this compiles against the Android 6 SDK.)
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int ID = 7;
    private static boolean running = false;
    private PowerManager.WakeLock wake;

    /** Called from the deck. state: "playing" (your own music is playing), "paused" (it's paused), "off" (no own music). */
    static void update(Context c, String state, String title, String artist) {
        boolean playing = "playing".equals(state);
        if (!playing && !running) return;
        Intent i = new Intent(c, PlaybackService.class);
        i.setAction(playing ? "playing" : ("paused".equals(state) ? "paused" : "off"));
        i.putExtra("title", title);
        i.putExtra("artist", artist);
        try {
            if (playing && !running) Context.class.getMethod("startForegroundService", Intent.class).invoke(c, i);
            else c.startService(i);
        } catch (Exception e) {
            Log.w("AquaMD", "playback service: " + e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if ("media".equals(action)) {
            MainActivity.media(intent.getStringExtra("cmd"));
            if (!running) stopSelf(startId);
            return START_NOT_STICKY;
        }
        if ("playing".equals(action)) {
            running = true;
            startForeground(ID, build(intent.getStringExtra("title"), intent.getStringExtra("artist"), true));
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AquaMD:playback");
                wake.setReferenceCounted(false);
            }
            wake.acquire(6 * 60 * 60 * 1000L);
            return START_NOT_STICKY;
        }
        if ("paused".equals(action) && running) {
            // Keep the notification so you can press play again, but let Android rest while nothing plays.
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(ID, build(intent.getStringExtra("title"), intent.getStringExtra("artist"), false));
            stopForeground(false);
            if (wake != null && wake.isHeld()) wake.release();
            return START_NOT_STICKY;
        }
        stop();
        return START_NOT_STICKY;
    }

    private void stop() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        stopForeground(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(ID);
        stopSelf();
    }

    private Notification build(String title, String artist, boolean playing) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b = new Notification.Builder(this);
        try {
            Class<?> ch = Class.forName("android.app.NotificationChannel");
            Object channel = ch.getConstructor(String.class, CharSequence.class, int.class).newInstance(CHANNEL, "Playing music", 2 /* IMPORTANCE_LOW: no sound */);
            NotificationManager.class.getMethod("createNotificationChannel", ch).invoke(nm, channel);
            Notification.Builder.class.getMethod("setChannelId", String.class).invoke(b, CHANNEL);
        } catch (Exception e) {
            Log.w("AquaMD", "notification channel: " + e);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title == null || title.isEmpty() ? "Aqua MD" : title)
                .setContentText(artist == null || artist.isEmpty() ? "Playing" : artist)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, flags))
                .setOngoing(playing)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", button("prev", 1, flags)).build())
                .addAction(playing
                        ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", button("pause", 2, flags)).build()
                        : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Play", button("play", 2, flags)).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", button("next", 3, flags)).build())
                .setStyle(new Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private PendingIntent button(String cmd, int code, int flags) {
        Intent i = new Intent(this, PlaybackService.class).setAction("media").putExtra("cmd", cmd);
        return PendingIntent.getService(this, code, i, flags);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stop(); // swiped away from recent apps: the deck is gone, so stop
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
