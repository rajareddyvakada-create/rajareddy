BAR REPLAY - Chrome extension (v2)

INSTALL
1. Unzip this folder.
2. Chrome -> chrome://extensions -> turn on Developer mode (top right).
3. Load unpacked -> choose the "bar-replay-extension" folder.
4. Pin it and click the icon to open Bar Replay.
(If you installed v1 before, remove it first.)

GOOGLE SIGN-IN (one-time, by the owner)
Extension ID (fixed): odiolklmlggafpajcjkhjncimmgbccad
1. https://console.cloud.google.com -> create a project.
2. APIs & Services -> OAuth consent screen -> External. App name "Bar Replay", your email.
   Scopes: email, profile, openid (no Google review needed for these).
   While in "Testing", add each person's Gmail under Test users (up to 100),
   or press "Publish app" so any Google account can sign in.
3. APIs & Services -> Credentials -> Create credentials -> OAuth client ID
   -> Application type: Web application
   -> Authorised redirect URIs: https://odiolklmlggafpajcjkhjncimmgbccad.chromiumapp.org/
4. Copy the Client ID, paste it into config.js, save, and press Reload on the extension.
Until this is done, the sign-in screen shows these steps and a "Continue without sign-in" button.

DATA
- Default: Binance PAXG/USDT (gold-backed token), live, no key needed.
- Real XAU/USD: tap Data -> "XAU/USD, forex and stocks" and paste a free Twelve Data API key
  (sign up at twelvedata.com). Free keys allow 800 requests a day; live mode uses 1 per minute.
- CSV: exports from TradingView or MT5 still work.

Chart engine: TradingView Lightweight Charts (Apache 2.0, see LICENSE-lightweight-charts.txt).
