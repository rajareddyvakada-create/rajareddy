package com.cot.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

/** The same hand-worked cases as tests/core.test.js, so the background check and the app agree. */
public class ScoringTest {

    private static final String[] DATES = {"a", "b", "c", "d", "e"};
    // 20 weekly bars, last close at the bottom of the range → discount
    private static double[][] discount() {
        double[][] p = new double[20][];
        for (int i = 0; i < 20; i++) p[i] = new double[]{110, 90, i == 19 ? 91 : 100};
        return p;
    }
    private static double[][] premium() {
        double[][] p = new double[20][];
        for (int i = 0; i < 20; i++) p[i] = new double[]{110, 90, i == 19 ? 109 : 100};
        return p;
    }

    @Test
    public void allBullishInDiscountIs100() {
        // zone +35, managed money up +30, swap dealers up (not extreme) +20, OI up with buying +15
        Scoring.Result r = Scoring.score(DATES, new double[]{100, 110, 120, 130, 150}, new double[]{10, 10, 10, 10, 12},
                new double[]{1000, 1000, 1000, 1000, 1100}, discount());
        assertEquals(100, r.score);
        assertEquals("Bullish", r.verdict);
    }

    @Test
    public void unchangedPositionIsNotASell() {
        // premium, no change anywhere except OI: −35 only (the old code gave −65)
        Scoring.Result r = Scoring.score(DATES, new double[]{100, 100, 100, 100, 100}, new double[]{5, 5, 5, 5, 5},
                new double[]{1000, 1000, 1000, 1000, 1200}, premium());
        assertEquals(-35, r.score);
        assertEquals("Lean bearish", r.verdict);
    }

    @Test
    public void extremeGroupBCountsAgainstItsMove() {
        // discount +20, managed money down −12, swap dealers extreme and rising −10 → −2
        Scoring.Result r = Scoring.score(DATES, new double[]{100, 100, 100, 100, 90}, new double[]{10, 10, 10, 10, 30},
                new double[]{1000, 1000, 1000, 1000, 1000}, discount());
        assertEquals(-2, r.score);
        assertEquals("Neutral", r.verdict);
    }

    @Test
    public void tooLittleHistoryIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> Scoring.score(new String[]{"a", "b"}, new double[]{1, 2},
                new double[]{1, 2}, new double[]{1, 2}, discount()));
    }
}
