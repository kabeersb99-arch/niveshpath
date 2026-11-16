// Diagnostic: which candidate sources answer from the GitHub runner? Prints status, type, size and a snippet. Changes nothing.
import { UA, htmlToText } from './lib.mjs';
const d = new Date(); do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
const dd = String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + d.getUTCFullYear();
const URLS = (process.argv.length > 2 ? process.argv.slice(2) : [
  'https://www.rbi.org.in/pressreleases_rss.xml', 'https://www.rbi.org.in/notifications_rss.xml', 'https://www.sebi.gov.in/sebirss.xml',
  'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
  'https://economictimes.indiatimes.com/wealth/rssfeeds/837555174.cms', 'https://www.livemint.com/rss/money', 'https://www.livemint.com/rss/markets',
  'https://www.business-standard.com/rss/finance-103.rss', 'https://www.business-standard.com/rss/markets-106.rss',
  'https://www.thehindubusinessline.com/markets/feeder/default.rss', 'https://www.thehindu.com/business/feeder/default.rss',
  `https://nsearchives.nseindia.com/content/indices/ind_close_all_${dd}.csv`, 'https://www.nseindia.com/api/ipo-current-issue',
  'https://www.nseindia.com/api/all-upcoming-issues?category=ipo', 'https://www.bseindia.com/publicissue.html',
  'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=10', 'https://www.ccilindia.com/web/ccil/tenorwise-indicative-yields',
  'https://www.fbil.org.in/', 'https://www.indiapost.gov.in/Financial/Pages/Content/Post-Office-Saving-Schemes.aspx', 'https://www.indiapost.gov.in/',
  'https://www.nsiindia.gov.in/InternalPage.aspx?Id_Pk=181', 'https://www.nsiindia.gov.in/', 'https://ibjarates.com/',
  'https://portal.amfiindia.com/spages/NAVAll.txt', 'https://api.frankfurter.app/latest?from=USD&to=INR', 'https://dea.gov.in/',
]);
for (const url of URLS) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
    const t = await r.text();
    const items = (t.match(/<item[\s>]/g) || []).length;
    const first = (t.match(/<item[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1];
    console.log(`PROBE ${r.status} | ${(r.headers.get('content-type') || '').slice(0, 30)} | ${t.length}b | ${url}\n      ${items ? `rss items=${items} first="${(first || '').trim().slice(0, 90)}"` : JSON.stringify((/^\s*[<{[]/.test(t) && /<html|<!doctype/i.test(t) ? htmlToText(t) : t).slice(0, 260))}`);
  } catch (e) { console.log(`PROBE ERR | ${url} | ${e.name}: ${e.message} ${e.cause ? e.cause.code || e.cause.message : ''}`); }
}
