## Claude Reset Timer + Auto-Send

A lightweight floating panel for **Claude.ai** that detects the rate-limit, shows a live countdown, lets you edit the reset time manually, and automatically clicks the **Send** button when the limit expires.

### Features

- **Triple detection** of the rate-limit reset time:

1. Network response interception (`fetch` API) — most reliable
2. Large modal dialog text parsing
3. **Inline banner above the composer** (e.g. "You've hit your usage limit. Your window resets at 2:47 PM")

- **Live countdown** showing hours/minutes until reset
- **Manual time editing** — click the pencil icon to set a custom reset time
- **Auto-send** — enable the checkbox and the script will click "Send" the moment the rate limit resets
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

### Supported languages

| Language | Auto-detected from |
| --- | --- |
| English | `en` |
| Español | `es` |
| Français | `fr` |

### Changelog
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
