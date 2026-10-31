# Browser tests for the Charts tab

These drive the real `charts.html` in a headless Chromium, so they catch what unit tests cannot:
the broker page covering the chart area, the source toggle's label, and the Scanner → chart flow.

    npm i -D playwright     # Chromium is already installed in the cloud container
    node tests/ui/chart-toggle.test.js
    node tests/ui/bridge-tab.test.js

Both print one PASS/FAIL line per check. They load the page from an absolute `file://` path — edit
the `p.goto(...)` line if your checkout is not at `/home/user/rajareddy`.
