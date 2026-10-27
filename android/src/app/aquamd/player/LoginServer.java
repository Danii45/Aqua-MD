package app.aquamd.player;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;

/**
 * Catches Spotify's login answer on http://127.0.0.1:43821/callback, the same return address the desktop app
 * uses, so one Spotify developer app works for both. Plain Java (no Android classes) so it can be tested anywhere.
 * Answers the browser with a page that sends you back to the app, then stops.
 */
final class LoginServer {
    interface Listener {
        void onLogin(String query);
        void onStopped();
    }

    static final int PORT = 43821;
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private final int port;
    private final Listener listener;
    private volatile ServerSocket server;
    private volatile boolean done;

    LoginServer(int port, Listener listener) {
        this.port = port;
        this.listener = listener;
    }

    void start() throws IOException {
        ServerSocket s = new ServerSocket();
        s.setReuseAddress(true);
        s.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 16);
        server = s;
        Thread t = new Thread(new Runnable() {
            @Override public void run() { loop(); }
        }, "aqua-login");
        t.setDaemon(true);
        t.start();
    }

    boolean running() { return server != null && !server.isClosed(); }

    void stop() {
        done = true;
        ServerSocket s = server;
        if (s != null) { try { s.close(); } catch (IOException e) { /* closing */ } }
    }

    private void loop() {
        try {
            while (!done) {
                final Socket s = server.accept();
                // Browsers open spare connections that never send anything, so each one gets its own thread.
                Thread t = new Thread(new Runnable() {
                    @Override public void run() {
                        try { handle(s); } catch (IOException e) { /* browser went away */ }
                        finally { try { s.close(); } catch (IOException e) { /* closed */ } }
                    }
                }, "aqua-login-conn");
                t.setDaemon(true);
                t.start();
            }
        } catch (IOException e) {
            // stop() closed the socket
        } finally {
            listener.onStopped();
        }
    }

    private void handle(Socket s) throws IOException {
        s.setSoTimeout(20000);
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), UTF8));
        String line = in.readLine();
        if (line == null) return;
        String header;
        while ((header = in.readLine()) != null && !header.isEmpty()) { /* skip headers */ }
        String[] parts = line.split(" ");
        String target = parts.length > 1 ? parts[1] : "/";
        OutputStream out = s.getOutputStream();
        int q = target.indexOf('?');
        String path = q >= 0 ? target.substring(0, q) : target;
        String query = q >= 0 ? target.substring(q + 1) : "";
        if (!"/callback".equals(path) || !query.contains("state=")) {
            write(out, "404 Not Found", "text/plain; charset=utf-8", "Not found");
            return;
        }
        synchronized (this) {
            if (done) { write(out, "200 OK", "text/html; charset=utf-8", page(query)); return; }
            done = true;
        }
        listener.onLogin(query);
        write(out, "200 OK", "text/html; charset=utf-8", page(query));
        stop();
    }

    private static void write(OutputStream out, String status, String type, String body) throws IOException {
        byte[] b = body.getBytes(UTF8);
        String head = "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length
                + "\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(UTF8));
        out.write(b);
        out.flush();
    }

    static String esc(String s) {
        return s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;");
    }

    /** The page the browser shows: a button back to the app (and an automatic try). */
    static String page(String query) {
        boolean cancelled = query.contains("error=");
        String link = esc("intent://callback?" + query + "#Intent;scheme=aquamd;package=app.aquamd.player;end");
        return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                + "<title>Aqua MD</title><style>"
                + "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:#070c17;color:#e4efff;font:19px/1.45 system-ui,sans-serif}"
                + "main{width:min(520px,100%);padding:22px;border-radius:28px;display:grid;gap:18px;background:rgba(72,150,255,.14);border:1.5px solid rgba(150,205,255,.45);box-sizing:border-box}"
                + ".lcd{border-radius:20px;padding:18px 20px;background:#04101f;border:2px solid rgba(150,205,255,.3)}"
                + "h1{margin:0;font:900 40px/1.1 ui-monospace,monospace;color:" + (cancelled ? "#ffcf7a" : "#8eeaff") + ";text-shadow:0 0 16px rgba(110,220,255,.5)}"
                + "p{margin:0;color:#9fb4d6}a{display:flex;align-items:center;justify-content:center;min-height:64px;border-radius:20px;"
                + "border:1.5px solid rgba(160,215,255,.6);background:rgba(110,170,255,.25);color:#f2fbff;font-weight:600;font-size:22px;text-decoration:none}"
                + "</style></head><body><main><div class=\"lcd\"><h1>" + (cancelled ? "CANCELLED" : "CONNECTED") + "</h1></div>"
                + "<p>" + (cancelled ? "You didn&#39;t agree, so Aqua MD isn&#39;t connected." : "Spotify said yes. Aqua MD is finishing the login.") + "</p>"
                + "<a id=\"back\" href=\"" + link + "\">Back to Aqua MD</a></main>"
                + "<script>setTimeout(function(){location.href=document.getElementById('back').href},200)</script></body></html>";
    }
}
