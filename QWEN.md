# Imagus Mass Download Mod - Project Documentation

## Project Overview

The Imagus Mass Download Mod is a community-driven modification of the original Imagus Chrome extension, rebuilt for modern Chrome Manifest V3 standards. This extension enhances the core "hover-to-enlarge" functionality with advanced bulk media downloading capabilities.

**Main Purpose**: To allow users to scan web pages and download all available media (images, videos) in bulk, with advanced filtering and progress tracking.

**Key Technologies**: JavaScript, HTML, CSS, Chrome Extension APIs (Manifest V3), Python build system

**Architecture**: Multi-layered extension with content scripts, background service workers, and UI components

## Project Structure

```
Imagus-Mass-Download-Mod/
├── build.py              # Python build script for MV2 minification (legacy)
├── README.md             # Main project documentation
├── README.txt            # Build instructions (legacy MV2)
├── Docs/                 # Technical documentation for developers
├── src/                  # Legacy Manifest V2 source code
├── src-mv3/              # Modern Manifest V3 source code (primary)
├── Imagus-Reborn-base/   # Upstream reference from hababr/Imagus-Reborn
├── bin/                  # Binary dependencies (minifiers)
├── minified/             # Minified sieve rules
├── unminified/           # Unminified source code
├── imagus-0.9.8.74.zip   # Original extension package
└── ...
```

## Key Features

### Core Functionality
- Enlarges thumbnails and shows images/videos when hovering over links
- Extensible set of rules for getting high-resolution media content
- User-defined rules to block/allow extension on specific sites

### Mass Download Mod Features
- **Advanced Mass Download**: Two-phase algorithm that scans pages, validates URLs in background, and uses heuristics for best quality media
- **Quick Start Hotkey**: Ctrl+Q to instantly start mass download process
- **Persistent Progress UI**: Dedicated tab showing real-time download progress with detailed stats
- **Powerful Pre-download Filtering**: Robust filtering system with pre-scan filtering, stop-words, and type/size filters
- **Operation Control**: Full cancellation capability with individual retry for failed downloads

## Building and Running

### Dependencies
- Python 3
- Java Runtime Environment (JRE)

### Build Process
```bash
# Install dependencies (Ubuntu/WSL)
sudo apt install python3 default-jre

# For Windows, install Python 3 and Java manually

# Build the extension
python3 build.py
```

The build script automatically downloads and manages:
- Closure Compiler (for JavaScript minification)
- htmlcompressor (for HTML compression)
- YUI Compressor (for CSS compression)

### Installation (Developer Mode)
1. Clone this repository or download the ZIP
2. Navigate to `chrome://extensions/` in your browser
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `src-mv3` folder from the project directory

For MV3 development, no build step is needed — just load `src-mv3/` unpacked.

## Development Architecture

### Manifest V3 Architecture (Current Stable)
- **Service Worker**: `background/service.js` handles core extension logic
- **Content Scripts**: Injected into web pages to find and manage media
- **UI Components**: Options page, popup, and download progress tracking

### Two-Phase Mass Download Algorithm
1. **Collection Phase (Content Script)**: Scans DOM elements for potential media URLs
2. **Validation Phase (Background Script)**: Validates URL arrays using content analysis and heuristic scoring

### Key Files
- `src-mv3/manifest.json`: Extension manifest for Chrome
- `src-mv3/background/service.js`: Core background logic (Service Worker)
- `src-mv3/content/content.js`: Content script logic (DOM scanning, hotkeys)
- `src-mv3/options/options.html`: Settings interface
- `src-mv3/data/sieve.json`: Rules for finding high-resolution media

### Sieve Engine
The `sieve.json` file contains rules for finding high-resolution images and media on different websites. This is the core of the extension's ability to find the best quality media.

## Development Conventions

### Code Organization
- **Component-based separation**: Different functionality in separate directories (background, content, options, common)
- **Vanilla JavaScript**: No external frameworks, pure JavaScript implementation
- **Event-driven architecture**: Communication between components via message passing

### Build Process
- Automated minification and compression via Python script
- Separate unminified sources for development and minified builds for distribution
- Dependency management through build script

### Testing and Quality
- Manual testing approach (no automated tests present)
- Real-world testing on various websites
- Community-driven bug reports and fixes

## Special Features

### Advanced Filtering System
- Stop-word matching to exclude unwanted content by keywords in text/href
- Configurable stop-words in `cfg.da.excludedKeywords`
- Type and size-based automatic filtering in background script
- Configurable thresholds for images and videos

### Progress Tracking
- Real-time progress monitoring in dedicated tab
- Detailed statistics on completed, pending, failed, and skipped files
- Persistent UI that survives browser navigation

### Circuit Breaker Pattern
- Automatic protection against server overload
- Graceful degradation when validation fails
- Recovery mechanism after timeout periods

## Project History

Based on the original [Imagus](https://github.com/Zren/chrome-extension-imagus) core and [Imagus Reborn](https://github.com/hababr/Imagus-Reborn) Manifest V3 version, this community-driven modification focuses on feature expansion and long-term compatibility with Chrome Extension SDK.

## Usage Instructions

1. Install the extension in developer mode as described above
2. Pin the extension button on Chrome toolbar
3. Navigate to a page with image/video galleries
4. Click the extension button or press Ctrl+Q to start bulk download
5. Monitor progress in the dedicated progress tab
6. Adjust filtering options in extension settings under "Download All Settings"

## Contributing

The project welcomes community contributions, particularly:
- Improving the sieve rules for better media detection
- Enhancing the filtering algorithms
- Adding support for new websites
- Improving the UI/UX of the progress tracking interface