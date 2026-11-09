package com.cot.widget;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;

/** Fetches CFTC positions and weekly prices, then scores each market. Used by the background check. */
final class MarketScanner {

    static final class Market {
        final String name, cftcCode, ticker;
        final boolean commodity;

        Market(String name, String cftcCode, String ticker, boolean commodity) {
            this.name = name;
            this.cftcCode = cftcCode;
            this.ticker = ticker;
            this.commodity = commodity;
        }
    }

    static final Market[] MARKETS = {
            new Market("Gold", "088691", "GC=F", true),
            new Market("Silver", "084691", "SI=F", true),
            new Market("Crude Oil", "067651", "CL=F", true),
            new Market("S&P 500", "13874A", "ES=F", false),
            new Market("Nasdaq", "209742", "NQ=F", false),
            new Market("Copper", "085692", "HG=F", true),
            new Market("Nat Gas", "023651", "NG=F", true),
            new Market("Bitcoin", "133741", "BTC-USD", false),
    };

    private MarketScanner() {
    }

    /** @return {ticker: {name, verdict, score, price}} for every market that loaded */
    static JSONObject scanAll() {
        JSONObject out = new JSONObject();
        for (Market m : MARKETS) {
            try {
                Scoring.Result r = scan(m);
                out.put(m.ticker, new JSONObject()
                        .put("name", m.name)
                        .put("verdict", r.verdict)
                        .put("score", r.score)
                        .put("price", r.price));
            } catch (Exception ignored) {
                // A market that fails this round is simply checked again next round.
            }
        }
        return out;
    }

    static Scoring.Result scan(Market m) throws Exception {
        String ds = m.commodity ? "72hh-3qpy" : "gpe5-46if";
        String fl = m.commodity ? "m_money_positions_long_all" : "asset_mgr_positions_long";
        String fs = m.commodity ? "m_money_positions_short_all" : "asset_mgr_positions_short";
        String ll = m.commodity ? "swap_positions_long_all" : "lev_money_positions_long";
        String ls = m.commodity ? "swap__positions_short_all" : "lev_money_positions_short";
        String url = "https://publicreporting.cftc.gov/resource/" + ds + ".json"
                + "?$select=" + enc("report_date_as_yyyy_mm_dd," + fl + "," + fs + "," + ll + "," + ls + ",open_interest_all")
                + "&$where=" + enc("cftc_contract_market_code='" + m.cftcCode + "'")
                + "&$order=" + enc("report_date_as_yyyy_mm_dd DESC")
                + "&$limit=12";
        JSONArray rows = new JSONArray(get(url));
        // Newest first from the API. A row with a missing or non-numeric field is skipped, never read as zero.
        List<Object[]> ok = new ArrayList<>();
        String lastDate = null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            String date = r.optString("report_date_as_yyyy_mm_dd", "");
            double[] v = {r.optDouble(fl, Double.NaN), r.optDouble(fs, Double.NaN), r.optDouble(ll, Double.NaN),
                    r.optDouble(ls, Double.NaN), r.optDouble("open_interest_all", Double.NaN)};
            boolean valid = date.length() >= 10;
            for (double x : v) if (Double.isNaN(x) || Double.isInfinite(x) || x < 0) valid = false;
            if (!valid || date.substring(0, 10).equals(lastDate)) continue;
            lastDate = date.substring(0, 10);
            ok.add(new Object[]{lastDate, v});
        }
        int n = ok.size();
        if (n < 5) throw new IOException("not enough COT history");
        String[] dates = new String[n];
        double[] inst = new double[n], lev = new double[n], oi = new double[n];
        for (int i = 0; i < n; i++) {
            Object[] e = ok.get(n - 1 - i);
            double[] v = (double[]) e[1];
            dates[i] = (String) e[0];
            inst[i] = v[0] - v[1];
            lev[i] = v[2] - v[3];
            oi[i] = v[4];
        }
        double[][] price = m.ticker.equals("BTC-USD") ? coinbaseWeekly() : yahooWeekly(m.ticker);
        if (price.length < 10) throw new IOException("not enough price history");
        return Scoring.score(dates, inst, lev, oi, price);
    }

    private static double[][] yahooWeekly(String ticker) throws Exception {
        IOException last = null;
        for (String host : new String[]{"query1", "query2"}) {
            try {
                JSONObject res = new JSONObject(get("https://" + host + ".finance.yahoo.com/v8/finance/chart/"
                        + enc(ticker) + "?interval=1wk&range=6mo"))
                        .getJSONObject("chart").getJSONArray("result").getJSONObject(0);
                JSONObject q = res.getJSONObject("indicators").getJSONArray("quote").getJSONObject(0);
                JSONArray h = q.getJSONArray("high"), l = q.getJSONArray("low"), c = q.getJSONArray("close");
                List<double[]> rows = new ArrayList<>();
                for (int i = 0; i < c.length(); i++) {
                    if (h.isNull(i) || l.isNull(i) || c.isNull(i)) continue;
                    double hi = h.getDouble(i), lo = l.getDouble(i), cl = c.getDouble(i);
                    if (hi < lo || cl > hi || cl < lo || lo <= 0) continue;   // impossible bar
                    rows.add(new double[]{hi, lo, cl});
                }
                return rows.toArray(new double[0][]);
            } catch (IOException e) {
                last = e;
            }
        }
        throw last;
    }

    private static double[][] coinbaseWeekly() throws Exception {
        JSONArray candles = new JSONArray(get("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"));
        int n = Math.min(140, candles.length());
        double[][] daily = new double[n][];
        for (int i = 0; i < n; i++) {
            JSONArray c = candles.getJSONArray(n - 1 - i); // newest first in the API
            daily[i] = new double[]{c.getDouble(2), c.getDouble(1), c.getDouble(4)};
        }
        List<double[]> weeks = new ArrayList<>();
        for (int end = n; end > 0; end -= 7) {
            int start = Math.max(0, end - 7);
            double hi = Double.NEGATIVE_INFINITY, lo = Double.POSITIVE_INFINITY;
            for (int i = start; i < end; i++) {
                hi = Math.max(hi, daily[i][0]);
                lo = Math.min(lo, daily[i][1]);
            }
            weeks.add(0, new double[]{hi, lo, daily[end - 1][2]});
        }
        return weeks.toArray(new double[0][]);
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
    }

    private static String get(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "Mozilla/5.0");
        c.setRequestProperty("Accept", "*/*");
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int r;
                while ((r = in.read(b)) > 0) buf.write(b, 0, r);
                return buf.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }
}
