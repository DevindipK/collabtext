/**
 * A real end-to-end test: two independent browser contexts (so they don't
 * share cookies/localStorage, i.e. genuinely two different "users"), each
 * joining the same document through the actual running server and client —
 * not mocks. It proves the property that actually matters for this project:
 * concurrent edits from two real browsers, over a real WebSocket, converge
 * to the same document.
 *
 * Requires the server (port 4000) and client dev server (port 5173) to
 * already be running:
 *   npm run dev   (from the repo root, see package.json)
 *
 * Then, from this directory:
 *   npm install
 *   node two-tab-sync.mjs
 *
 * Uses your system Chrome rather than a downloaded Playwright browser, so it
 * has no extra binary to install beyond `playwright-core` itself. Set
 * CHROME_PATH to override the default location.
 */
import { chromium } from 'playwright-core';

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const docId = 'e2e-' + Date.now();
const url = `${CLIENT_URL}/?doc=${docId}`;

let failures = 0;
function report(label, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures++;
}

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const pageA = await (await browser.newContext()).newPage();
const pageB = await (await browser.newContext()).newPage();

async function join(page, name) {
  await page.goto(url);
  await page.waitForSelector('.join-card', { timeout: 10000 });
  await page.fill('.field:nth-of-type(1) input', name);
  await page.click('.btn-primary');
  await page.waitForSelector('.editor');
}

await join(pageA, 'Alice');
await join(pageB, 'Bob');
await pageA.waitForTimeout(500); // let both sides finish their init handshake

// Alice types; Bob should see it live, no reload.
await pageA.click('.editor');
await pageA.type('.editor', 'Hello from Alice');
await pageB.waitForTimeout(600);
report('Bob sees Alice\'s text live', (await pageB.locator('.editor').inputValue()) === 'Hello from Alice');

// Bob appends; both should converge.
await pageB.click('.editor');
await pageB.press('.editor', 'End');
await pageB.type('.editor', ' and Bob');
await pageA.waitForTimeout(600);
const [aText, bText] = await Promise.all([pageA.locator('.editor').inputValue(), pageB.locator('.editor').inputValue()]);
report('sequential edits converge', aText === bText, aText);

// Presence.
const [aPresence, bPresence] = await Promise.all([pageA.locator('.presence').innerText(), pageB.locator('.presence').innerText()]);
report('Alice sees Bob in presence', aPresence.includes('Bob'));
report('Bob sees Alice in presence', bPresence.includes('Alice'));

// True concurrency: both type at the document start at the same moment.
await pageA.click('.editor');
await pageA.press('.editor', 'Home');
await pageB.click('.editor');
await pageB.press('.editor', 'Home');
await Promise.all([pageA.type('.editor', '[A]'), pageB.type('.editor', '[B]')]);
await pageA.waitForTimeout(700);
const [aConc, bConc] = await Promise.all([pageA.locator('.editor').inputValue(), pageB.locator('.editor').inputValue()]);
report('concurrent same-position edits converge', aConc === bConc, aConc);

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed.');
