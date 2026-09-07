# Page Screenshot Tool

A dependency-free Chrome/Edge Manifest V3 extension for visible-area and full-page PNG screenshots. Captures and image processing stay entirely inside the browser.

Created by **ELIEZER MAWULI JUNIOR**.

## Install in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `page-screenshot-tool` folder.
5. Pin **Page Screenshot Tool** from the Extensions menu if desired.

For Microsoft Edge, use `edge://extensions`, enable **Developer mode**, and choose **Load unpacked**.

## Test

1. Open a normal webpage (an `http://` or `https://` page).
2. Click the extension icon.
3. Click **Capture Visible Area** and verify the preview and dimensions.
4. Test **Download PNG**, **Copy Screenshot**, and the large-preview button.
5. Click **Retake Screenshot**.
6. Click **Capture Full Page** on a page several viewports tall.
7. Confirm that the page returns to its original scroll position.
8. Test a page with horizontal overflow and a fixed or sticky header.
9. Test a protected page such as `chrome://settings` and verify that a helpful error appears.

Chrome blocks script injection on browser-internal pages, the Chrome Web Store, and some built-in PDF viewers. Visible-area capture can also be blocked on some protected surfaces. These restrictions are enforced by the browser.

## Project structure

```text
page-screenshot-tool/
├── manifest.json
├── background.js
├── content.js
├── image-store.js
├── popup.html
├── popup.css
├── popup.js
├── preview.html
├── preview.css
├── preview.js
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── tools/
    └── generate-icons.js
```

The icon generator uses only Node.js built-ins and is optional. Run `node tools/generate-icons.js` from this folder to regenerate the PNG icons.

## How full-page capture works

The extension first performs a short measurement pass to settle ordinary lazy-loaded content. It then creates exact horizontal and vertical capture positions, scrolls sequentially, shows each section in a live preview, and records each viewport as PNG. During stitching, overlap from the final partial row/column is cropped from the source tile, so content is not duplicated. Fixed and actively stuck elements are only retained in the appropriate edge tile. Page scroll position and temporary capture styles are restored in a `finally` path, on popup close, and by a 60-second inactivity safety timer that refreshes throughout long captures.

## Architecture blueprint

```text
Popup capture controls
        │
        ▼
Manifest V3 service worker ──► Active browser tab
        │                           │
        │                           ├─ measure and stabilize page
        │                           ├─ scroll to capture positions
        │                           └─ restore original page state
        ▼
Sequential viewport PNG tiles
        │
        ├─► Progressive popup preview
        ▼
Local canvas stitching
        │
        ▼
PNG Blob in extension IndexedDB
        │
        ├─► Full-screen preview
        ├─► Clipboard
        └─► User-approved download
```

## Copyright and license notice

Copyright (c) 2026 **ELIEZER MAWULI JUNIOR**. All rights reserved. See [`NOTICE.md`](NOTICE.md).
