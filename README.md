## Claude Reset Timer + Auto-Send

A lightweight floating panel for **Claude.ai** that detects the rate-limit, shows a live countdown, lets you edit the reset time manually, and automatically clicks the **Send** button when the limit expires.

### Features

- **Triple detection** of the rate-limit reset time:

1. Network response interception (`fetch` API) — most reliable
2. Large modal dialog text parsing
3. **Inline banner above the composer** (e.g. "You've hit your usage limit. Your window resets at 2:47 PM")

- **Live countdown** showing hours/minutes until reset
- **Manual time editing** — click the pencil icon to set a custom reset time
- **Auto-send** — enable the checkbox and the script will click "Send" (or "Continue" / "Retry", whichever applies) shortly after the rate limit resets
- **Message counter** — shows how many messages you have sent in the current chat and an estimate of the chat's total characters
- **Usage log** — each time the rate limit is detected, the message and character counts of that chat are saved (last 20 hits) and printed to the browser console, so you can find your own threshold
- **Multi-language support** — English, Spanish, French (auto-detected from browser/page language)
- **Draggable panel** — snaps to screen edges, position is remembered
- **Robust retry logic** — exponential backoff, max 20 attempts, automatic cancellation on persistent failure
- **Watchdog timer** — ensures auto-send still fires even if the browser throttles long `setTimeout` calls

### How to use

1. Install a userscript manager (Tampermonkey, Violentmonkey, Greasemonkey).
2. Install this script.
3. Open [claude.ai](https://claude.ai).
4. When you hit the rate limit, the panel will appear (or update) with the reset time.
5. Check **Auto-send** if you want the message to be sent automatically when the limit resets.
6. You can drag the panel to reposition it; it will snap to edges.

### Usage log and warning threshold

The panel shows `My msgs N · X.Xk` (your messages in the current chat · total characters). Characters are an estimate of how heavy the conversation is; a message with a large pasted file weighs far more than a short one.

When the rate limit is detected, open the browser console (filter by `[ClaudeResetTimer]`) to see a table with the message and character counts at that moment. After a few cycles you will know roughly where your limit sits.

An optional warning is included but **disabled by default**. To enable it, edit the constants at the top of the script:

```js
const WARN_ENABLED = true;
const WARN_MSGS = 25;     // warn at 25 of your messages in a chat (or null)
const WARN_CHARS = 60000; // warn at ~60k characters in a chat (or null)
```

The counter turns red once either threshold is reached.

### Supported languages

| Language | Auto-detected from |
| --- | --- |
| English | `en` |
| Español | `es` |
| Français | `fr` |

### Changelog

**v2.2.0**

- Added a message counter to the panel: shows your messages in the current chat and an estimate of total chat characters.
- Added a usage log: when the rate limit is detected, the message and character counts of the current chat are saved (last 20 hits) and printed to the console.
- Added an optional warning threshold (disabled by default, configurable via `WARN_ENABLED`, `WARN_MSGS`, `WARN_CHARS`).
- Widened the panel from 500 px to 560 px to fit the new column.

**v2.1.7**

- Auto-send now waits 5 seconds after the reset time before the first click, since the server sometimes still rejects the send at the exact second.
- Added support for the "Retry" link that appears after a failed send.
- Fixed false "sent" confirmations: verification now waits 5 seconds and also checks for the Retry link.

**v2.1.6**

- Changed button priority: if the composer has text, the Send button is used. The "Continue" button is only tried when the composer is empty.

**v2.1.5**

- Added support for the disabled "Continue" button that sometimes appears instead of the composer. It uses the same reset timer and retry logic as the Send button.
- "Continue" takes priority over "Send" when both are present.
- Post-click verification for "Continue" checks that the button disappeared or became disabled again.

**v2.1.4**

- Fixed: after a successful send, the watchdog kept retrying every 20s until the retry limit was reached, which also unchecked "Auto-send" by itself. Each rate-limit cycle is now marked as resolved once its message is sent, and a new cycle re-arms automatically.

**v2.1.3**

Added support for basic and dark mode

**v2.1.2**

Fixed time issue for spanish

**v2.1.1**

- Added detection for the **small inline banner** above the composer (not just the large modal)
- Improved MutationObserver to scan descendants of added nodes
- Added periodic DOM scan (every 10s) as a fallback for banners that exist on load
- Expanded fetch interceptor to also watch `/message` endpoints

**v2.1.0**

- Added multi-language support (es/en/fr)
- Added exponential backoff and max retry limit (20 attempts)
- Improved send-button detection with 3-level fallback
- Safer state sanitization on load
- Cleaner timer lifecycle management

**v2.0.6**

- Removed aggressive page reload logic
- Improved debug logging

**v2.0.5**

- Initial release

### License

MIT
