package app.aquamd.player;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

/**
 * Runs while you log in to Spotify in the browser: listens on 127.0.0.1:43821 for the answer (LoginServer) and,
 * as a short foreground service, keeps Android from pausing Aqua MD while the browser is in front.
 * Stops as soon as the answer arrives, or after 10 minutes.
 */
public class LoginService extends Service {
    private static final String CHANNEL = "login";
    private static final int ID = 8;
    private final Handler main = new Handler(Looper.getMainLooper());
    private LoginServer server;
    private final Runnable giveUp = new Runnable() { @Override public void run() { finish(); } };

    static void start(Context c) {
        Intent i = new Intent(c, LoginService.class);
        try { Context.class.getMethod("startForegroundService", Intent.class).invoke(c, i); }
        catch (Exception e) { Log.w("AquaMD", "login service: " + e); }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(ID, notification());
        if (server == null || !server.running()) {
            server = new LoginServer(LoginServer.PORT, new LoginServer.Listener() {
                @Override public void onLogin(final String query) {
                    main.post(new Runnable() { @Override public void run() { MainActivity.receiveLogin(query); } });
                }
                @Override public void onStopped() {
                    main.post(new Runnable() { @Override public void run() { finish(); } });
                }
            });
            try {
                server.start();
            } catch (Exception e) {
                Log.w("AquaMD", "can't listen for the Spotify login: " + e);
                finish();
                return START_NOT_STICKY;
            }
        }
        main.removeCallbacks(giveUp);
        main.postDelayed(giveUp, 10 * 60 * 1000L);
        return START_NOT_STICKY;
    }

    private void finish() {
        main.removeCallbacks(giveUp);
        if (server != null) server.stop();
        stopForeground(true);
        stopSelf();
    }

    private Notification notification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder b = new Notification.Builder(this);
        try {
            Class<?> ch = Class.forName("android.app.NotificationChannel");
            Object channel = ch.getConstructor(String.class, CharSequence.class, int.class).newInstance(CHANNEL, "Spotify login", 2);
            NotificationManager.class.getMethod("createNotificationChannel", ch).invoke(nm, channel);
            Notification.Builder.class.getMethod("setChannelId", String.class).invoke(b, CHANNEL);
        } catch (Exception e) {
            Log.w("AquaMD", "notification channel: " + e);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Log in to Spotify in your browser")
                .setContentText("Then tap Back to Aqua MD.")
                .setContentIntent(PendingIntent.getActivity(this, 10, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(giveUp);
        if (server != null) server.stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
