# NiveshPath (Phases 1 to 3)

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

## Data feeds (all confirmed from GitHub's servers on 16 Nov 2026)

| Feed | Source | Status |
|---|---|---|
| Mutual fund NAVs | AMFI NAVAll.txt | working |
| Gold and silver | ibjarates.com | working |
| Small savings rates | India Post "Saving Schemes" page | working (2- and 3-year TD carried from the last notification; the page shows only the range) |
| Yield curve, T-Bills, 10-year | CCIL tenor-wise indicative yields | working (indicative, not the FBIL benchmark) |
| USD/INR | Frankfurter (ECB reference rate) | working |
| IPO filings | SEBI draft offer documents / RHPs | working |
| News | RSS: RBI, ET Wealth, Mint, BusinessLine, The Hindu | working |
| Nifty, Sensex, live IPO subscription | NSE / BSE | **blocked**: they refuse automated access. Needs a broker market-data API key |
| PIB, Business Standard RSS | | **blocked** |

A failed feed never shows old numbers silently. It shows "stale since ...", and GitHub flags the run with a warning. `node scripts/probe.mjs` (also run on every manual workflow run) reports which sources answer.

IPO dates, price bands and lot sizes are entered by hand in `www/data/facts.json` under `ipos`, each with a source and date, because the exchanges block automated access.

## Everyday maintenance

- **A rate or rule changed and the app has not caught it**: edit `www/data/facts.json` on GitHub (pencil icon), update `value`, `asOf`, `source`, `url`, commit. The site rebuilds itself.
- **Run the data job now**: Actions → Site and data → Run workflow.
- **Run tests on your computer** (needs Node 20+): `npm test`. Preview locally: `npm run serve`, then open http://localhost:8080.
- **Back up your holdings**: Settings → Create encrypted backup. Keep the text somewhere safe. It opens only with your PIN.

## Phase 3 features

- **UPS vs NPS calculator** (My plan → Choose UPS or NPS): payout, lump sum, break-even NPS return, in today's rupees. A thinking aid built on the published rules, not the official calculator.
- **Tax view** (Portfolio): new vs old regime with your salary, the true tax rate on your interest, and tax if market holdings were sold today.
- **Compliance** (Portfolio): yearly meter, pace to year-end, transaction log, single-transaction flags, intimation draft, allowed / not allowed guide.
- **CAS import** (Portfolio): reads a CAMS/KFintech statement PDF on the device with the bundled pdf.js (`www/vendor/`, Apache 2.0). **Tested on a sample in the CAMS layout, not on a real statement.**
- **24 lessons** across L0 to L10, each with a 5-question quiz and spaced revision. Custom goals in My plan.

## Known limitations

- No Nifty/Sensex levels, live IPO subscription, allotment status or listing prices (exchanges block automated access).
- The fund list is not ranked: the AMFI file has no expense ratio, tracking error or fund size.
- No push notifications yet. They need a free Firebase project that only you can create. Update cards appear on Home.
- The APK is debug-signed. Each new build has a new signature, so Android will ask you to uninstall the old one first: make an encrypted backup in Settings before updating. A fixed signing key (four repository secrets) removes this.
- Limits and exit rules on several product cards are marked "unverified – check source". Rates are sourced separately.
- The CAS reader does not handle NSDL/CDSL demat statements yet, and may need adjusting for your statement's layout.
- The Tax view ignores NPS/UPS contributions, HRA and surcharge; its old-regime standard deduction (Rs 50,000) is unverified.
- No sync between devices. Use backup and restore. Forgetting the PIN means erasing the data.
- Bank FD rates come from aggregator sites and are marked "secondary".
- The 10-year yield chart with RBI policy dates needs history; the app starts collecting it from the first run.

See `DECISIONS.md` for every choice made and why.
