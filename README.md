# NiveshPath (Phase 1)

A private app to learn, track and plan safe investing in India. One codebase runs as a website/PWA and as an Android APK.

Education and tracking only. Not a SEBI-registered investment adviser. No orders, no referral links.

## What is inside

| Folder | What it is |
|---|---|
| `www/` | The whole app. No build step. `index.html`, `styles.css`, `js/`, `data/` |
| `www/data/facts.json` | Every dated fact with source, as-of date and status |
| `www/data/live.json` | Feed snapshots written by the data job (small savings, IBJA, AMFI) |
| `scripts/` | Data job: fetch, validate, store, detect changes |
| `tests/` | 30 tests: every finance formula, every parser, staleness guard |
| `.github/workflows/site.yml` | Runs tests, refreshes data 3 times a day, publishes the website |
| `.github/workflows/apk.yml` | Builds the Android APK on a release tag |

## Set up (about 15 minutes, no coding)

You need one free account: **GitHub**.

1. Sign up at github.com. Click **+** (top right) → **New repository**. Name it `niveshpath`. Choose **Public** (free GitHub Pages needs a public repo; the repo holds no personal data). Click **Create repository**.
2. On the new page click **uploading an existing file**. Unzip `niveshpath.zip` on your computer and drag *everything inside the folder* into the page, including the `.github` folder (on Windows turn on "Hidden items" in File Explorer's View menu; on Mac press Cmd+Shift+. to see it). Click **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set **Source** to **GitHub Actions**.
4. Go to **Settings → Actions → General → Workflow permissions**. Choose **Read and write permissions**. Save.
5. Go to the **Actions** tab → **Site and data** → **Run workflow**. Wait for the green tick (2 to 3 minutes).
6. Your app is now at `https://YOUR-USERNAME.github.io/niveshpath/`. Open it on your phone, create a PIN, then use the browser menu → **Add to Home screen**.

### Get the Android APK

1. In the repo: **Releases → Create a new release → Choose a tag** → type `v0.1.0` → **Publish release**.
2. The **Android APK** workflow starts by itself (about 6 to 8 minutes). When it is green, the release page has an `.apk` file. Download it on your phone and install (allow "install unknown apps" for your browser).
3. This first APK is debug-signed, which is fine for your own phone. For a properly signed release APK and an AAB for the Play Store, create a keystore once and add four repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Ask me for the exact steps when you want this.

## First run checklist (important)

The data job could not be run against the live sites from the build sandbox. After step 5 above, open the run log and the app's **Settings → Data health**:

- **AMFI NAVs**: should turn green. The parser was tested on real lines from the 13-15 Nov 2026 file.
- **IBJA gold and silver**: tested on a sample shaped like the page as read on 13 Nov 2026. If it fails, the app keeps the 13 Nov snapshot with a yellow "stale" badge.
- **Small savings rates**: the two source addresses in `scripts/update_all.mjs` (`SOURCES.smallSavings`) are unconfirmed. If this feed fails, the app keeps the verified Oct-Dec 2026 rates with a yellow badge. Send me the log line and I will fix the source.

A failed feed never shows old numbers silently. It shows "stale since …", and GitHub emails you a warning for the run.

## Everyday maintenance

- **A rate or rule changed and the app has not caught it**: edit `www/data/facts.json` on GitHub (pencil icon), update `value`, `asOf`, `source`, `url`, commit. The site rebuilds itself.
- **Run the data job now**: Actions → Site and data → Run workflow.
- **Run tests on your computer** (needs Node 20+): `npm test`. Preview locally: `npm run serve`, then open http://localhost:8080.
- **Back up your holdings**: Settings → Create encrypted backup. Keep the text somewhere safe. It opens only with your PIN.

## Known limitations in Phase 1

- Nifty, Sensex and USD/INR tiles are empty until a market-data feed is added (Phase 2).
- Limits and exit rules on several product cards are marked "unverified – check source" until checked against the official page. Rates are sourced separately.
- No push notifications yet (Phase 2, needs a free Firebase account). Update cards appear on Home.
- No sync between devices. Use backup and restore.
- Forgetting the PIN means erasing the data. There is no recovery.
- Bank FD rates come from aggregator sites and are marked "secondary".
- The APK workflow has not been run yet; the first tag is its first real test.

See `DECISIONS.md` for every choice made and why.
