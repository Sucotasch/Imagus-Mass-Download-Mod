# 🚀 Imagus Mass Download Mod (MV3 Version)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This is a deeply modified version of the **Imagus** extension, rebuilt for the modern **Chrome Manifest V3** standard. Beyond the core "hover-to-enlarge" functionality, this mod introduces a powerful toolkit for bulk media downloading.

> **Note:** The `mv3-version` branch is the current stable development line, fully rewritten to comply with Google Chrome's latest security and performance requirements.

## Key Features
Core:
Enlarges thumbnails and shows images/videos when hovering over links.
▪ An extensible set of rules for getting images, media or other content with higher resolution.
▪ A list of user-defined rules to block/allow the extension to work on specific sites.

Mod:
- **Advanced Mass Download:** A completely redesigned two-phase algorithm scans the page, validates URLs in the background, and uses heuristics to find the best quality media, ensuring more accurate and reliable downloads.
- **Quick Start Hotkey:** Press `Ctrl+Q` to instantly start the mass download process on the current page.
- **Persistent Progress UI:** A dedicated tab opens to show the real-time progress of all downloads. It provides detailed stats on completed, pending, failed, and skipped files.
- **Powerful Pre-download Filtering:** To avoid downloading unwanted content, the mod includes a robust filtering system:
  - **Pre-scan Filtering:** In-page filtering of invisible elements and elements matching stop-words *before* the main scan, significantly improving performance on large pages.
  - **Stop-Words:** Configure a list of keywords in the settings to exclude links containing them (e.g., "avatar", "profile").
  - **Filter by Type & Size:** Automatically skips common UI image types and checks file sizes before downloading to avoid tiny images or videos. These values are configurable.
- **Operation Control:** The download process can be fully canceled at any time. Failed or canceled downloads can be retried individually from the progress page.

## 🛠 Installation (Developer Mode)

Since this mod uses custom enhancements, it must be installed manually via Developer Mode:

1. Clone this repository or download the ZIP for the `mv3-version` branch.
2. Navigate to `chrome://extensions/` in your browser.
3. Enable **"Developer mode"** in the top-right corner.
4. Click the **"Load unpacked"** button.
5. Select the **`src-mv3`** folder from the downloaded project directory.

The extension is now installed and ready to use.

## Usage
Pin the extension button on the Chrome toolbar, go to a page with a video or image gallery, click the button and follow the instructions that appear below it. After starting the bulk download, a new tab with progress, statistics and controls will open. Filtering options can be changed in the main extension settings, section Download All Settings.

---

### 👨‍💻 About
Based on the original [Imagus](https://github.com/Zren/chrome-extension-imagus) core and [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) manifest v3 version.  
This community-driven modification focuses on feature expansion and long-term compatibility with the Chrome Extension SDK.
