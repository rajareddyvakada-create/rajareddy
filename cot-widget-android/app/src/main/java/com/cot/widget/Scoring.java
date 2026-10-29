package com.cot.widget;

/** Same scoring as Core.scoreCot()/premiumDiscount() in assets/charts/core.js. Keep both in step (ScoringTest checks the same cases). */
final class Scoring {

    static final class Result {
        final int score;
        final String verdict;
        final double price;
        final String cotDate;

        Result(int score, String verdict, double price, String cotDate) {
            this.score = score;
            this.verdict = verdict;
            this.price = price;
            this.cotDate = cotDate;
        }
    }

    private Scoring() {
    }

    /**
     * @param dates COT report dates, oldest first
     * @param inst  group A net position: managed money (commodities) or asset managers (financials)
     * @param lev   group B net position: swap dealers (commodities) or leveraged funds (financials)
     * @param oi    open interest
     * @param price weekly rows of {high, low, close}, oldest first
     */
    static Result score(String[] dates, double[] inst, double[] lev, double[] oi, double[][] price) {
        int pn = price.length;
        int from = Math.max(0, pn - 20);
        double high = Double.NEGATIVE_INFINITY, low = Double.POSITIVE_INFINITY;
        for (int i = from; i < pn; i++) {
            high = Math.max(high, price[i][0]);
            low = Math.min(low, price[i][1]);
        }
        double last = price[pn - 1][2];
        double rng = high - low;
        double pos = rng == 0 ? 50 : Math.max(0, Math.min(100, (last - low) / rng * 100));
        boolean discount = !(pos > 50);

        int n = inst.length;
        if (n < 5 || price.length == 0) throw new IllegalArgumentException("not enough history");
        int cur = n - 1, prev = n - 2, four = n >= 5 ? n - 5 : 0;
        double dLev = lev[cur] - lev[prev];
        double dOi = oi[cur] - oi[prev];
        double tInst = inst[cur] - inst[four];

        int score = 0;
        if (discount) score += tInst >= 0 ? 35 : 20;
        else score -= tInst <= 0 ? 35 : 20;

        if (tInst > 0) score += discount ? 30 : 12;
        else if (tInst < 0) score -= !discount ? 30 : 12;   // no change scores 0

        double levSum = 0;
        for (double v : lev) levSum += Math.abs(v);
        boolean levExtreme = Math.abs(lev[cur]) > 1.2 * (levSum / n);
        if (dLev > 0 && !levExtreme) score += 20;
        else if (dLev < 0 && !levExtreme) score -= 20;
        else if (dLev > 0) score -= 10;
        else if (dLev < 0) score += 10;

        if (dOi > 0 && tInst > 0) score += 15;
        else if (dOi > 0 && tInst < 0) score -= 15;

        score = Math.max(-100, Math.min(100, score));
        return new Result(score, verdictFor(score), last, dates[cur]);
    }

    static String verdictFor(int score) {
        if (score >= 40) return "Bullish";
        if (score >= 15) return "Lean bullish";
        if (score > -15) return "Neutral";
        if (score > -40) return "Lean bearish";
        return "Bearish";
    }
}
