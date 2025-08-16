# Imagus Mass Downloader Mod

This is a community-modified version of the Imagus extension for Google Chrome, based on https://github.com/Zren/chrome-extension-imagus and enhanced with powerful features for bulk downloading of media from web pages.

## Key Features
Core:
Enlarges thumbnails and shows images/videos when hovering over links.
▪ An extensible set of rules for getting images, media or other content with higher resolution.
▪ A list of user-defined rules to block/allow the extension to work on specific sites.

Mod:
- **Mass Download:** Scan the current web page to find all media that can be zoomed by Imagus and download them all with a single click.
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

## Usage
Pin the extension button on the Chrome toolbar, go to a page with a video or image gallery, click the button and follow the instructions that appear below it. After starting the bulk download, a new tab with progress, statistics and controls will open. Filtering options can be changed in the main extension settings, section Download All Settings.
