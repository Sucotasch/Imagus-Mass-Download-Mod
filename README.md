# Imagus Mass Downloader Mod

This is a community-modified version of the Imagus extension, enhanced with powerful features for bulk downloading of media from web pages.

## Key Features

- **Mass Download:** Scan the current web page to find all media that can be zoomed by Imagus and download them all with a single click or hotkey (default: 'X').
- **Persistent Progress UI:** A dedicated tab opens to show the real-time progress of all downloads. It provides detailed stats on completed, pending, failed, and skipped files.
- **Pre-download Filtering:** To avoid downloading unwanted thumbnails and icons, the mod includes a powerful pre-filtering system:
  - **Filter by Type:** Automatically skips common UI image types (e.g., `.png`, `.svg`).
  - **Filter by Size:** Checks the file size before downloading and skips files that are too small (e.g., images < 45KB, videos < 2MB). These values are configurable in the extension's options.
- **Operation Control:** The download process can be fully canceled at any time from the progress page. Failed or canceled downloads can be retried individually.

## Installation

1. Download the latest version by cloning this repository or downloading the `src` folder.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable "Developer mode" using the toggle in the top-right corner.
4. Click the "Load unpacked" button.
5. Select the `src` folder from the downloaded project files.

The extension is now installed and ready to use.