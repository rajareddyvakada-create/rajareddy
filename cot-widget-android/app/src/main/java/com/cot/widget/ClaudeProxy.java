package com.cot.widget;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sends Claude requests for the app's pages with the key from {@link SecretStore}, so the key is never in page
 * scripts or browser storage. Only the Messages endpoint is reachable, request size and token budget are capped,
 * and at most 30 requests go out per 10 minutes (cost control).
 * Pages call start() and poll result(id) until it returns {"status": code, "body": "..."}.
 */
final class ClaudeProxy {

    private static final String URL_MESSAGES = "https://api.anthropic.com/v1/messages";
    private static final int MAX_BODY = 400_000, MAX_TOKENS = 16_000, MAX_PER_WINDOW = 30;
    private static final long WINDOW_MS = 10 * 60_000L;

    private static final ExecutorService NET = Executors.newSingleThreadExecutor();
    private static final Map<String, String> RESULTS = new ConcurrentHashMap<>();
    private static final ArrayDeque<Long> RECENT = new ArrayDeque<>();

    private ClaudeProxy() {
    }

    static String start(Context ctx, String body, String beta) {
        String id = UUID.randomUUID().toString();
        String problem = check(body);
        if (problem != null) {
            RESULTS.put(id, error(400, problem));
            return id;
        }
        synchronized (RECENT) {
            long now = System.currentTimeMillis();
            while (!RECENT.isEmpty() && now - RECENT.peekFirst() > WINDOW_MS) RECENT.pollFirst();
            if (RECENT.size() >= MAX_PER_WINDOW) {
                RESULTS.put(id, error(429, "App limit reached: " + MAX_PER_WINDOW + " Claude requests per 10 minutes. Try again shortly."));
                return id;
            }
            RECENT.addLast(now);
        }
        String key = SecretStore.get(ctx);
        if (key == null) {
            RESULTS.put(id, error(401, "No Claude API key is saved on this phone. Add it in AI agent settings."));
            return id;
        }
        String betaHeader = beta != null && beta.matches("[a-z0-9-]+(,[a-z0-9-]+)*") ? beta : null;
        NET.execute(() -> RESULTS.put(id, send(key, body, betaHeader)));
        return id;
    }

    /** The finished result (removed once read), or null while the request is still running. */
    static String result(String id) {
        return id == null ? null : RESULTS.remove(id);
    }

    private static String check(String body) {
        if (body == null || body.length() > MAX_BODY) return "Request too large.";
        try {
            JSONObject b = new JSONObject(body);
            if (!b.optString("model").startsWith("claude-")) return "Unknown model.";
            int max = b.optInt("max_tokens", 0);
            if (max < 1 || max > MAX_TOKENS) return "max_tokens must be 1-" + MAX_TOKENS + ".";
            JSONArray m = b.optJSONArray("messages");
            if (m == null || m.length() == 0) return "No messages.";
            if (b.has("stream") && b.optBoolean("stream")) return "Streaming isn't supported here.";
            return null;
        } catch (Exception e) {
            return "Request is not valid JSON.";
        }
    }

    private static String send(String key, String body, String beta) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(URL_MESSAGES).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15_000);
            c.setReadTimeout(180_000);
            c.setDoOutput(true);
            c.setRequestProperty("content-type", "application/json");
            c.setRequestProperty("x-api-key", key);
            c.setRequestProperty("anthropic-version", "2023-06-01");
            if (beta != null) c.setRequestProperty("anthropic-beta", beta);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = "";
            if (in != null) {
                try (InputStream s = in) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] b = new byte[8192];
                    int r;
                    while ((r = s.read(b)) > 0) buf.write(b, 0, r);
                    text = buf.toString("UTF-8");
                }
            }
            return new JSONObject().put("status", code).put("body", text).toString();
        } catch (Exception e) {
            return error(0, "Couldn't reach Claude. Check your connection.");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String error(int status, String message) {
        try {
            String body = new JSONObject().put("error", new JSONObject().put("message", message)).toString();
            return new JSONObject().put("status", status).put("body", body).toString();
        } catch (Exception e) {
            return "{\"status\":" + status + ",\"body\":\"{}\"}";
        }
    }
}
