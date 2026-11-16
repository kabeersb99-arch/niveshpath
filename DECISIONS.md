# Decisions (Phase 1, 16 Nov 2026)

1. **No-build frontend (plain ES modules) instead of React + Vite + Tailwind.**
   Why: the build sandbox had no package-registry access, so a React/Vite build could not be run or tested here. A no-build app is exactly what was tested in Chrome and exactly what ships. It also loads fast on a low-end phone and has nothing to break for a non-developer. Capacitor only needs the `www/` folder. Moving to React later is possible; `finance.js`, `content.js` and the data layer carry over unchanged.
2. **Backend = GitHub Actions on a schedule, snapshots committed to the repo.** (One of the three options in the brief.)
   Why: one free account, no keys, every snapshot is versioned in git (a free rate history), and the app reads static files only. Supabase/Cloudflare become worthwhile in Phase 2 for push notifications.
3. **Holdings never leave the device.** They are encrypted with AES-256-GCM using a key derived from the PIN (PBKDF2, 150,000 rounds) and kept in browser storage. "Only I can log in" is met by the PIN; there is no server account to breach. Backup is an encrypted text blob.
   Cost: no automatic sync between phone and laptop yet (use backup/restore).
4. **Web hosting = GitHub Pages.** Note: on a free GitHub plan Pages needs a *public* repo. The repo holds no personal data (profile and holdings are on the device only), but the code and public rates are visible. Use Cloudflare Pages with a private repo if you prefer.
5. **No personal details in the code.** The repo and site are public, so the profile ships empty (no employer, designation, dates, loan or goal figures). You type your profile once in Settings; it is stored encrypted on your device only.
6. **Return ranges and crash sizes are labelled assumptions**, kept in `facts.json > assumptions`: equity crash 50%, gold fall 20%.
7. **Compliance Meter counts cautiously**: buys and sells of funds, ETFs, bonds, T-Bills, G-Secs, SGBs and RBI bonds. PPF, NSC and deposits are not counted. A basic meter ships now; the full version is Phase 3.
8. **IBJA**: IBJA advises users who price products off its rates to subscribe to its official API. This app reads the public page twice a day for one person's private display, with attribution, and honours robots.txt. If you want strict compliance, subscribe to the IBJA API or switch `SOURCES.metals`.
9. **APK**: the workflow always builds a debug-signed APK (installable by sideloading). A properly signed release APK/AAB is built when the four signing secrets are added.
10. **Grey Market Premium** will be left out of the IPO Centre (Phase 2).
11. **Biometric lock** needs a Capacitor plugin and is deferred to Phase 2; PIN lock works on web and APK now.

# Phase 2 decisions (16 Nov 2026)

12. **Sources were chosen by testing them from GitHub's servers** (`scripts/probe.mjs`). NSE, BSE, PIB and Business Standard refuse automated access, so they are not used. Yields come from CCIL's public indicative table, labelled as indicative.
13. **IPO Centre** = SEBI filing feed (automatic) + a small hand-entered list of dated IPOs with sources. No GMP. SME IPOs are explained but not listed.
14. **Fund list is unranked on purpose.** Ranking by NAV would mislead; expense ratio and tracking error are not in the AMFI file.
15. **News** stores headline, link and time only, filtered by keywords. No article text, no AI summary yet.
16. **Push notifications deferred**: Firebase needs an account and keys that only the owner can create.
17. **USD/INR** uses the ECB reference rate through Frankfurter, labelled as such, because the RBI/FBIL rate has no open feed.

# Phase 3 decisions (16 Nov 2026)

18. **UPS vs NPS model**: one growth rate for basic + DA, and "basic as a share of basic + DA at retirement" as an explicit input, because pay commissions cannot be forecast. NPS returns of 7/9/11% and a 6% annuity rate are labelled assumptions.
19. **Tax view** models slab tax, rebate, marginal relief and cess. It deliberately leaves out pension contributions, HRA and surcharge and says so.
20. **CAS import runs entirely on the device** with a vendored copy of pdf.js. PAN, name, address, email and phone lines are skipped by the parser and never stored.
21. **Compliance, Tax and CAS live under Portfolio**, and the pension calculator under My plan, to keep the bottom bar at seven items.
22. **Market history lesson** uses month-end index data from one named source and states that other sources quote larger intraday falls.

# Phase 4 decisions (16 Nov 2026)

23. **Admin alert = a failing GitHub run.** GitHub already emails the owner when a workflow fails, so a feed that is down twice in a row fails a final `health` job. No extra account or key.
24. **Service worker is network-first for everything**, with the cache as the offline fallback, so a new release or new data is never hidden by a stale cache.
25. **Browser smoke test is not run on GitHub**, to keep the pipeline dependency-free. The data job has a full integration test that does run there.
26. **No chart library.** History is shown as tables; "text and tables come first" was a design principle of the brief.
