# Wally

Wally is an income, expense and budget tracker in Malaysian Ringgit (RM). It installs on iPhone like an app and stores your data in **your own Google Sheet**, so you can log in from any device.

**Live app:** https://razinraziq13.github.io/wally/

## Features

- **Smart Dashboard:** total balance, this month's income, expenses and net, a 6-month income vs expense chart, budget status and recent transactions.
- **Monthly Budget:** a total limit plus a limit per category. Shows what's left, safe-to-spend per day and a month-end forecast, with alerts at 80% and when you go over.
- **Smart Money Insights:** comparisons with last month (like-for-like when the month isn't over yet), top categories, the biggest increases and decreases, savings rate, daily average, largest expense and busiest weekday.
- **Activity:** every transaction grouped by day, with All / Expenses / Income filters. Tap one to edit or delete it.
- **Sync:** changes save on the device first and then go to the sheet. The ✓ Synced / Offline status shows at the top of the screen, and it works offline.
- **Backup, restore and CSV export** from the ☰ menu.
- Light and dark mode, and it can be added to the Home Screen (PWA).

Expense categories: Food & Drinks, Transportation, Shopping, Bills & Utilities, Groceries, Others.
Income categories: Salary, Business, Gift, Others.

## How it works

```
 iPhone / laptop                     Google
┌──────────────┐  HTTPS (JSON)  ┌────────────────────┐     ┌────────────────┐
│  Wally (PWA) │ ─────────────▶ │ Apps Script Web app │ ──▶ │ Your Google    │
│  index.html  │ ◀───────────── │ apps-script/Code.gs │ ◀── │ Sheet (4 tabs) │
│ local copy + │                └────────────────────┘     └────────────────┘
│ offline queue│
└──────────────┘
```

| File | What it is |
|---|---|
| `index.html` | The whole app (HTML, CSS and JavaScript in one file) |
| `sw.js` | Service worker for offline use (loads from the network first, falls back to the cache) |
| `manifest.json`, `icon-*.png` | Home Screen name and icon |
| `apps-script/Code.gs` | The Google Apps Script that turns your sheet into Wally's storage |

The script creates these tabs in your sheet: **Transactions**, **Budgets**, **Users** and **Sessions**.

## Setup (one time, about 10 minutes)

### 1. Create the sheet and script
1. Go to [sheets.new](https://sheets.new) and name the sheet "Wally".
2. Open **Extensions → Apps Script**.
3. Delete everything in `Code.gs`, paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs), then click **Save**.

### 2. Deploy it as a Web app
1. Click **Deploy → New deployment**, then ⚙️ **→ Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
3. Authorize with your Google account. When you see *"Google hasn't verified this app"*, click **Advanced → Go to Wally (unsafe)**, then **Allow**. This warning is normal for your own script.
4. Copy the **Web app URL**. It ends in `/exec`.

### 3. Connect Wally
1. Open https://razinraziq13.github.io/wally/ (on iPhone, use **Safari**).
2. Paste the `/exec` link, tap **Connect**, then **Create account**.
3. On iPhone: **Share → Add to Home Screen**.
4. On each other device: open the app, paste the same link, then **Log in**.

### 4. Lock new sign-ups (recommended)
Once your account exists, set `ALLOW_NEW_ACCOUNTS = false` in the script. Then go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same `/exec` link.

## Security and privacy

- **Your password never leaves the device.** The app sends a PBKDF2 hash (150,000 rounds), and the sheet stores only a SHA-256 of that hash.
- After **10 wrong passwords**, the username is locked for 15 minutes. Each device's login lasts 180 days, and **Log out** ends it.
- Each request is checked against the logged-in user, so one account can't read another account's rows.
- Text is saved to the sheet as plain text, so nothing can run as a formula.
- **Keep private:** the `/exec` link and the Google Sheet itself. This repository holds no secrets or data, so it's safe for it to be public.
- Keep a passcode or Face ID on your phone, because the app keeps a local copy of your data.

## Using and maintaining it

- **Forgot your password:** in the sheet, delete your row in the **Users** tab, then create the account again with the **same username**. Your data stays.
- **Don't rename** the four tabs **or move their columns.** You can add your own tabs for charts and formulas.
- **Updating the app:** commit changes to `main`, and GitHub Pages republishes in about a minute. Open the app once online to get the new version.
- **Updating the script:** paste the new code into Apps Script, then go to **Deploy → Manage deployments → ✏️ → New version** to keep the same link.
- **Speed and limits:** each sync takes about 1–2 seconds. The app syncs when you open it, after each change and every 60 seconds while it's on screen. This is well within Google's free limits for personal use.

## Troubleshooting

| Message | Fix |
|---|---|
| *"That link did not answer like Wally"* | Use the **Web app** link ending in `/exec` (not `/dev` or the editor link). Check that access is **Anyone**. |
| *"Could not reach your Google Sheet"* | Check your internet connection. Your changes stay on the device and sync later. |
| *"Your login has expired"* | Log in again. Unsynced changes on that device are kept. |
| *"Creating new accounts is turned off"* | `ALLOW_NEW_ACCOUNTS` is `false`. That's expected once you've locked sign-ups. |
| Changes don't show up on another device | Tap the sync status at the top of the screen to sync now. |
