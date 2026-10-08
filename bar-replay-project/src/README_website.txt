BAR REPLAY - WEBSITE (works on phone and computer)

All files sit in one folder with no subfolders, so they're easy to upload from a phone.

PUT IT ONLINE FREE WITH GITHUB PAGES (can be done from a phone browser)
1. Unzip this file (Android: Files by Google -> tap the zip -> Extract. iPhone: Files app -> tap the zip).
2. Go to github.com and create a free account.
3. Tap "+" -> New repository. Name: bar-replay. Public. Create repository.
4. Tap "uploading an existing file", select ALL files from the unzipped folder, then "Commit changes".
5. Repository Settings -> Pages -> Source: "Deploy from a branch" -> Branch: main, folder: / (root) -> Save.
6. After about a minute your site is live at:  https://YOUR-USERNAME.github.io/bar-replay/
It works right away with "Continue without sign-in" until Google sign-in is set up.

GOOGLE SIGN-IN (one time)
1. console.cloud.google.com -> APIs & Services -> OAuth consent screen -> External.
   Scopes: email, profile, openid. Add testers' Gmail addresses, or "Publish app" so anyone can sign in.
2. Credentials -> Create credentials -> OAuth client ID -> Web application.
   (You can reuse the one made for the Chrome extension.)
   Authorised JavaScript origins -> add:  https://YOUR-USERNAME.github.io
3. Copy the Client ID. On GitHub open config.js -> pencil (edit) icon -> paste it between the quotes -> Commit.
4. Wait a minute and reload the site.

INSTALL ON YOUR PHONE
Android Chrome: menu -> Add to Home screen.  iPhone Safari: Share -> Add to Home Screen.

DATA
- Default: Binance PAXG/USDT (gold-backed token), live, no key needed.
- Real XAU/USD: tap Data -> "XAU/USD, forex and stocks" and paste your free Twelve Data API key.
  Each user uses their own key; it stays in their own browser.
- CSV exports from TradingView or MT5 also work.

Chart engine: TradingView Lightweight Charts (Apache 2.0, see LICENSE-lightweight-charts.txt).
