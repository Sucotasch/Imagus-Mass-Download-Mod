# GEMINI.md

## Project Overview

This project is a community-modified version of the Imagus Chrome extension, designed for mass downloading of media from web pages. The core functionality of Imagus is to enlarge thumbnails and show full-size images and videos on hover. This modification adds a "Mass Download" feature that scans a webpage for all Imagus-compatible media and downloads them in bulk.

Key features of the modification include:

*   **Bulk Downloading:** A single-click action to download all supported media on a page.
*   **Persistent Progress UI:** A dedicated tab to monitor download progress with detailed statistics.
*   **Pre-download Filtering:** A system to filter media by type and size to avoid unwanted downloads.
*   **Operation Control:** The ability to cancel the download process and retry failed downloads.

The project is written in JavaScript and is designed to be loaded as an unpacked extension in Google Chrome.

## Building and Running

### Dependencies

*   Python 3
*   Java

### Building the Extension

The project uses a Python script to build and minify the extension files. To build the extension, run the following command:

```sh
python3 build.py
```

The build script uses the following tools:

*   **Closure Compiler:** For minifying JavaScript files.
*   **htmlcompressor:** For compressing HTML files.
*   **YUI Compressor:** For compressing CSS files.

### Running the Extension

To run the extension in Chrome:

1.  Navigate to `chrome://extensions`.
2.  Enable "Developer mode".
3.  Click "Load unpacked".
4.  Select the `src` directory.

## Key Files

*   `src/manifest.json`: The manifest file for the Chrome extension, defining its structure, permissions, and entry points.
*   `src/background.html` & `src/js/background.js`: The background script that handles the core logic of the extension, including the download process.
*   `src/includes/content.js`: The content script that is injected into web pages to find and manage media.
*   `src/options.html` & `src/js/options.js`: The options page for configuring the extension's settings.
*   `src/download-progress.html` & `src/js/download-progress.js`: The UI and logic for the download progress page.
*   `src/sieve.jsn`: A JSON file containing the rules (sieves) for finding high-resolution images and media on different websites.
*   `build.py`: The Python script used to build and package the extension.

## Development Conventions

*   The project uses a build process to minify and compress the source code for production.
*   The `sieve.jsn` file is a critical part of the extension, and development on the sieves is a key part of maintaining and extending the extension's functionality.
*   The `unminify_all` script suggests that development is done on unminified source files, and the build process creates the minified versions for release.
