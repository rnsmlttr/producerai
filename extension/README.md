# Producer.ai Download Suite

**Version 3.2** | *By rnsmlttr*

The ultimate downloading toolkit for Producer.ai. This universal browser extension transforms your workflow by taking advantage of the new bulk download functions Prod added, allowing for bulk downloads of tracks, stems, and diverse formats with powerful organization features.

## 🚀 Key Features

### 1. Comprehensive Format Support

* **Tracks (Direct)**: Download your generated songs directly as **WAV**, **MP3**, or **M4A**.
* **Tracks (Zipped)**: Download any audio format wrapped in a clean `.zip` archive.
* **Stems**:
  * **Zipped**: Get a single `.zip` file containing all stem tracks (Drums, Bass, Other, etc.).
  * **Unzipped (Folder)**: Automatically creates a folder on your drive and saves individual stems into it.

### 2. Flexible Selection Modes

* **Selected Only**: Downloads specific songs you've checked in your Library list.
* **All Visible Songs**: Grabs everything currently loaded on the page (great for Sessions or long lists).
* **Full Playlist**: Automatically downloads an entire playlist when you are on a playlist page.

### 3. Smart Output Organization

* **Default**: Saves files directly to your Downloads folder.
* **Generic Folder**: Groups all downloads into a `Producer_AI_Downloads` folder.
* **Smart Folder**: Dynamically creates folders based on the Playlist name or Page title (e.g., `My Techno Album/Song1.wav`).

## 📥 Installation (Chromium)

1. Download or clone this repository.
2. Open Chrome/other Chromium browser and navigate to `chrome://extensions`.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"** in the top left.
5. Select the folder containing this extension.

## 🛠️ Usage

1. Navigate to [Producer.ai](https://www.producer.ai).
2. Go to your **Library**, a **Session**, or a **Playlist**.
3. (Optional) Select specific songs using the checkboxes if you want to use "Selected Only" mode.
4. Click the **Producer.ai Suite icon** in your Chrome toolbar.
5. Configure your settings:
   * **Preset**: Choose how many songs to grab.
   * **Format**: Select your desired Audio or Stem format.
   * **Output**: Choose your folder organization preference.
6. Click **Start Download**.
7. Watch the status panel on-screen as your files are processed!

## 🌐 Browser Compatibility

### Chrome / Edge / Brave

Follow the standard [Installation](#-installation) instructions above.

### Firefox

1. **Important**: Rename `manifest_firefox.json` to `manifest.json`. (You may want to backup the original `manifest.json` first).
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click **"Load Temporary Add-on..."**.
4. Select the `manifest.json` file.

### Safari (macOS)

1. You will need Xcode installed.

2. Run the following command in Terminal:
   
   ```bash
   xcrun safari-web-extension-converter /path/to/producerai/extension
   ```

3. Follow the prompts to build and run the extension in Safari.

## ⚠️ Notes

* **Authentication**: The extension leverages your active browser session. Ensure you are logged in.
* **Popups**: If downloading multiple files, Chrome may ask for permission to download multiple files. Click "Allow".
* **Rate Limiting**: A small safety delay is built-in between downloads to ensure stability.


