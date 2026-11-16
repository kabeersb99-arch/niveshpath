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
