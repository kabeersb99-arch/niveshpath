# How to maintain NiveshPath

Written for a non-developer. Everything here is done in a web browser on github.com, in your repo **kabeersb99-arch/niveshpath**.

- Web app: https://kabeersb99-arch.github.io/niveshpath/
- APK downloads: the **Releases** page of the repo

## What runs by itself

| What | When | Where to see it |
|---|---|---|
| Data refresh (NAVs, gold, savings rates, yields, USD/INR, SEBI filings, news) | 08:15, 13:45 and 23:45 IST every day | Actions tab → "Site and data" |
| Website rebuild | After every data refresh and every file change | Same |
| APK build | When you publish a Release with a tag like `v1.0.1` | Actions tab → "Android APK" |
| Alert email | When a feed fails on two runs in a row, the run turns red and GitHub emails you | Your GitHub email |

GitHub pauses scheduled jobs in a repo with no activity for 60 days. The data job commits fresh data every day, so this should not happen. If it does, open the Actions tab and click **Enable workflow**.

## Monthly check (5 minutes)

1. Open the app → **Settings → Data health**. Every feed should be green.
2. Read any amber line about hand-entered rates that are over 45 days old (FD rates, repo rate, CPI) and update them (next section).
3. **Settings → Create encrypted backup.** Copy the text somewhere safe.
4. Glance at the Actions tab: the latest "Site and data" run should have a green tick.

## Updating a fact by hand

Some figures have no feed and live in `www/data/facts.json`: repo rate, CPI, FD rates, tax rules, conduct rules, IPO dates.

1. In the repo open `www/data/facts.json` and click the pencil icon.
2. Find the entry (for example `"repo"`). Change `value`, `asOf`, `source` and `url`. Keep the quotes and commas exactly as they are.
3. Click **Commit changes**. The site rebuilds in about a minute.

If the site does not update, you probably broke the JSON punctuation. Open the Actions tab, click the red run, and the error names the line. Or paste the file into jsonlint.com to find the mistake.

### When to update what

| Fact | How often | Official source |
|---|---|---|
| `repo` | After each RBI policy meeting (about every two months) | rbi.org.in press releases |
| `cpi` | Around the 12th of each month | mospi.gov.in |
| `fd.*` | Monthly, or after a repo change | Each bank's own rate page |
| `frsb` | 1 January and 1 July | RBI press release |
| `ipos` | When an IPO announces dates | NSE / BSE IPO pages, the RHP |
| `tax.*` | After each Union Budget (1 February) | incometax.gov.in |
| `conduct.*`, `ups.*`, `nps.*` | When DoPT or PFRDA issues a new order | dopt.gov.in, pfrda.org.in |
| `assumptions` | Whenever you want different planning numbers | Your judgement |

Small savings rates, gold, NAVs, yields and USD/INR update themselves. The 2-year and 3-year Time Deposit rates are the exception: India Post's page shows only the range, so if the app shows a "Small savings rates changed" card, open `www/data/live.json`, and correct `td2` and `td3` from the Ministry of Finance notification.

### Adding an IPO

In `facts.json`, copy one block inside `"ipos": [ ... ]`, paste it after a comma, and edit name, dates (YYYY-MM-DD), `bandLow`, `bandHigh`, `lot`, `source`, `url`, `asOf`. Delete blocks for IPOs that have listed.

## A feed is failing

The app keeps showing the last good data with a yellow "stale since" badge, so nothing breaks. To fix it:

1. Actions tab → click the red run → click **build** → open the step "Refresh data". The line starting `x` or `FAILED` names the feed and the reason.
2. Common reasons and fixes:
   - `HTTP 403`, `HTTP 5xx` or a timeout: the source is down or blocking. Wait a day. If it persists, the site may have started refusing automated access.
   - `could not read ...`, `no rate rows found`, `only N ... found`: the page layout changed. The parser in `scripts/parsers.mjs` needs adjusting. Open a new chat with Claude, attach `scripts/parsers.mjs` and the error line, and ask for a fix with a test.
   - `robots.txt disallows`: the site has asked robots not to fetch that page. Do not override it. Find another official source.
3. Click **Run workflow** on "Site and data" to try again. Manual runs also print a "Probe" step showing which sources answer.

Sources that refuse automated access today (tested 16 Nov 2026): NSE, BSE, PIB, Business Standard. This is why there are no index levels or live IPO subscription numbers.

## Releasing a new APK

1. Repo → **Releases → Draft a new release → Choose a tag** → type the next version (`v1.0.1`) → **Create new tag** → **Publish release**.
2. Wait about 3 minutes. The APK appears under the release's Assets.
3. On your phone: in the old app make an encrypted backup, uninstall it, install the new APK, create a PIN, then **Restore**.

Step 3 is needed because the APK is debug-signed and each build has a different signature. To stop that, create a signing key once and add four repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) under Settings → Secrets and variables → Actions. The workflow then also builds a signed release APK and an AAB. You must create and enter these yourself; never share the passwords.

You rarely need a new APK. The web app updates itself, and the phone app only needs rebuilding when the app's code changes.

## Changing lesson text or adding a lesson

Lessons are in `www/js/content.js`, `content2.js` and `content3.js`. Each lesson is one block with `id`, `title`, `simple`, `body`, `example`, `quiz` and `sources`. Edit text between quotes. Words in curly braces like `{ppf}` are filled from live data; leave them as they are.

## If you forget the PIN

There is no recovery. On the lock screen tap **Forgot PIN**, then restore your latest backup with the PIN that was in use when the backup was made. This is why the monthly backup matters.

## Running the tests on a computer (optional)

Install Node.js 20 or newer, download the repo as a zip, and in that folder run `npm test`. All tests should pass. `npm run serve` previews the app at http://localhost:8080. `tests/e2e/smoke.cjs` is a browser walk-through that also checks offline mode (instructions at the top of the file).

## What is deliberately not in the app

- No broker login, no order placement, no referral links.
- No PAN, Aadhaar, bank account numbers or passwords stored anywhere.
- No analytics or tracking.
- No derivatives, intraday, crypto, forex or margin products. No grey market premium.
- No employer, designation or personal details in the public code.

## Still open

- Push notifications (needs a free Firebase project that only you can create).
- Index levels and live IPO data (needs a broker market-data API key).
- A fixed APK signing key (needs the four secrets above).
- NSDL/CDSL demat statement import.
- Checking the product cards marked "unverified – check source" against official pages.
- An AI news digest (needs an API key).
- A chart of the 10-year yield with RBI policy dates (the app has been collecting history since 16 Nov 2026).
