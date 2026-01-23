(function () {
    // prevent multiple injections
    if (window.hasInjectedProducerDownloader) return;
    window.hasInjectedProducerDownloader = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "INIT_DOWNLOADER") {
            startDownloader(request.config);
        }
    });

    async function startDownloader(config) {
        console.log("🚀 Starting Downloader with config:", config);

        let cancelled = false;
        const ui = createStatusUI(() => {
            cancelled = true;
            ui.addLog("Cancelled by user.", "error");
            ui.finish(0, 0, true); // mark as cancelled
        });

        const pendingDownloads = new Map(); // downloadid -> songtitle
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === "DOWNLOAD_COMPLETE") {
                if (pendingDownloads.has(msg.downloadId)) {
                    const title = pendingDownloads.get(msg.downloadId);
                    ui.markFinished(title);
                    pendingDownloads.delete(msg.downloadId);
                }
            }
        });
        ui.addLog("Initializing...");

        const token = getAuthToken();
        if (!token) {
            ui.showError("Could not find login session. Refresh page.");
            return;
        }
        ui.addLog("Authenticated", "success");

        // --- 1. identify songs ---
        let songs = [];
        const isAllMode = config.mode === 'all' || config.mode === 'playlist';

        if (!isAllMode) {
            // selected only
            const checkboxes = Array.from(document.querySelectorAll('button[aria-label="Deselect song"]'));
            if (checkboxes.length === 0) {
                ui.showError("No songs selected. Check boxes or use 'All Visible' mode.");
                return;
            }
            songs = checkboxes.map(cb => {
                const row = cb.closest('[role="button"]');
                return extractSongData(row);
            }).filter(s => s);
        } else {
            // all / playlist mode
            // Selector: div[role="button"] that has aria-label "Open details for..."
            const rows = Array.from(document.querySelectorAll('div[role="button"][aria-label^="Open details for"]'));
            if (rows.length === 0) {
                ui.showError("No song rows found on this page.");
                return;
            }
            songs = rows.map(row => extractSongData(row)).filter(s => s);
        }

        ui.addLog(`Found ${songs.length} songs.`);
        ui.updateProgress(0, songs.length, "Preparing...");

        // --- 2. determine folder path ---
        let folderPrefix = "";
        if (config.folder === 'generic') {
            const date = new Date().toISOString().split('T')[0];
            folderPrefix = `ProdAI_Downloads_${date}/`;
        } else if (config.folder === 'smart') {
            // try to find playlist title
            const titleEl = document.querySelector('div[role="textbox"].font-display') || document.querySelector('h1') || document.querySelector('h2');
            let plTitle = titleEl ? titleEl.innerText : "Producer_Playlist";
            plTitle = sanitizeFilename(plTitle);
            folderPrefix = `${plTitle}/`;
        }

        // --- 3. process downloads ---
        let successCount = 0;
        let failCount = 0;

        let fileExt = config.format || 'wav';
        let urlFormat = fileExt;

        let needsSanitization = config.meta === 'none' || config.meta === 'clean';

        // handle special formats
        if (fileExt === 'stems') {
            urlFormat = 'stems'; // individual stems
            needsSanitization = false; // can't easily sanitize streams of stems yet
        } else if (fileExt === 'stems_zip') {
            fileExt = 'zip';
            urlFormat = 'stems_zip';
            needsSanitization = false;
        } else if (fileExt.startsWith('tracks_zip')) {
            urlFormat = fileExt;
            fileExt = 'zip';
        }


        for (const [index, song] of songs.entries()) {
            if (cancelled) {
                ui.addLog(`🛑 Process Stopped.`, "error");
                break;
            }

            try {
                ui.updateProgress(index, songs.length, `Downloading ${index + 1}/${songs.length}`);

                if (urlFormat === 'stems') {
                    // --- handle stems (folder) ---
                    // ... (stems logic remains same)
                    ui.addLog(`Fetching stems info: ${song.title}`, "download");
                    let downloadUrl = `https://www.producer.ai/__api/stems/${song.id}`;

                    const response = await fetch(downloadUrl, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!response.ok) throw new Error(`Stems API Error: ${response.status}`);

                    const data = await response.json();
                    if (!data.stems) throw new Error("No stems found");
                    const stemKeys = Object.keys(data.stems);
                    ui.addLog(`Found ${stemKeys.length} stems for ${song.title}`, "info");

                    for (const stemName of stemKeys) {
                        const base64Data = data.stems[stemName];
                        if (!base64Data) continue;
                        const stemFilename = `${folderPrefix}${song.title}_Stems/${stemName}.m4a`;
                        const dataUri = `data:audio/mp4;base64,${base64Data}`;
                        chrome.runtime.sendMessage({ type: "DOWNLOAD", url: dataUri, filename: stemFilename }, (res) => {
                            if (res?.success) pendingDownloads.set(res.downloadId, `${song.title} (${stemName})`);
                        });
                        await new Promise(r => setTimeout(r, 200));
                    }
                    ui.markSuccess(index);
                    successCount++;

                } else if (urlFormat === 'stems_zip') {
                    // --- handle stems (zip) ---
                    ui.addLog(`Fetching stems info: ${song.title}`, "download");
                    const response = await fetch(`https://www.producer.ai/__api/stems/${song.id}`, { headers: { 'Authorization': `Bearer ${token}` } });
                    if (!response.ok) throw new Error(`Stems API Error: ${response.status}`);
                    const data = await response.json();
                    const stemKeys = Object.keys(data.stems || {});

                    const zip = new JSZip();
                    const folder = zip.folder(`${song.title}_Stems`);
                    for (const stemName of stemKeys) {
                        const b64 = data.stems[stemName];
                        if (b64) folder.file(`${stemName}.m4a`, b64, { base64: true });
                    }
                    const content = await zip.generateAsync({ type: "blob" });
                    downloadBlob(content, `${folderPrefix}${song.title}_Stems.zip`);
                    ui.markSuccess(index);
                    ui.markFinished(`${song.title} (ZIP)`);
                    successCount++;

                } else if (urlFormat.startsWith('tracks_zip')) {
                    // --- handle tracks (zip) ---
                    const subFormat = urlFormat.replace('tracks_zip_', '') || 'wav';
                    ui.addLog(`Fetching ${subFormat} for Zip: ${song.title}`, "download");

                    const blob = await fetchTrackBlob(song.id, subFormat, token);
                    let finalBlob = blob;

                    if (needsSanitization) {
                        ui.addLog(`Sanitizing metadata...`, "info");
                        finalBlob = await sanitizeAudioBlob(blob, subFormat, config.meta);
                    }

                    const zip = new JSZip();
                    zip.file(`${song.title}.${subFormat}`, finalBlob);

                    const content = await zip.generateAsync({ type: "blob" });
                    downloadBlob(content, `${folderPrefix}${song.title}.zip`);
                    ui.markSuccess(index);
                    ui.markFinished(`${song.title} (ZIP)`);
                    successCount++;

                } else {
                    // --- handle regular audio ---
                    const filename = `${folderPrefix}${song.title}.${fileExt}`;

                    if (needsSanitization) {
                        // Must fetch locally first to sanitize
                        ui.addLog(`Downloading & Sanitizing: ${song.title}`, "download");
                        const blob = await fetchTrackBlob(song.id, urlFormat, token);
                        const cleanBlob = await sanitizeAudioBlob(blob, urlFormat, config.meta);
                        downloadBlob(cleanBlob, filename);
                        ui.markSuccess(index);
                        ui.markFinished(song.title);
                        successCount++;
                    } else {
                        // Standard download
                        let downloadUrl = `https://www.producer.ai/__api/${song.id}/download?format=${urlFormat}`;
                        ui.addLog(`Queueing: ${song.title}`, "download");
                        chrome.runtime.sendMessage({
                            type: "DOWNLOAD",
                            url: downloadUrl,
                            filename: filename,
                            headers: [{ name: "Authorization", value: `Bearer ${token}` }]
                        }, (response) => {
                            if (response && response.success) {
                                pendingDownloads.set(response.downloadId, song.title);
                                ui.markSuccess(index);
                                successCount++;
                            } else {
                                ui.markFail(index, response?.error || "Error");
                                failCount++;
                            }
                        });
                    }
                }

                if (urlFormat !== 'stems') await new Promise(r => setTimeout(r, 600));

            } catch (err) {
                console.error(err);
                ui.addLog(`Failed: ${song.title} - ${err.message}`, "error");
                failCount++;
            }
        }

        if (!cancelled) {
            ui.updateProgress(songs.length, songs.length, "Finished");
            ui.finish(successCount, failCount);
        }
    }

    // --- helper fetcher ---
    async function fetchTrackBlob(songId, format, token) {
        const url = `https://www.producer.ai/__api/${songId}/download?format=${format}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        return await res.blob();
    }

    // --- Sanitizer ---
    async function sanitizeAudioBlob(blob, format, mode) {
        const buffer = await blob.arrayBuffer();

        if (format === 'wav') {
            return sanitizeWav(buffer, mode);
        } else if (format === 'mp3') {
            return sanitizeMp3(buffer, mode);
        }
        // m4a/other not supported for deep sanitization yet
        return blob;
    }

    function sanitizeWav(buffer, mode) {
        // Simple RIFF parser to strip LIST (INFO) chunks
        const view = new DataView(buffer);
        const chunks = [];
        let offset = 12; // Skip RIFF header

        // header check
        if (view.getUint32(0, false) !== 0x52494646) return new Blob([buffer], { type: 'audio/wav' }); // Not RIFF

        // rebuild buffer parts
        const parts = [];
        parts.push(buffer.slice(0, 12)); // RIFF + size + WAVE

        while (offset < view.byteLength) {
            if (offset + 8 > view.byteLength) break;
            const chunkId = view.getUint32(offset, false); // big-endian (actually RIFF chunks are usually LE or BE mixed? WAV is LE usually for data, but let's check ASCII)
            // wait, extracting 4 chars string
            const idStr = String.fromCharCode(
                view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)
            );
            const size = view.getUint32(offset + 4, true); // Little endian size

            const totalChunkSize = 8 + size + (size % 2); // pad byte if odd

            if (idStr === 'LIST') {
                // This contains metadata (INFO)
                if (mode === 'none') {
                    // skip completely
                } else if (mode === 'clean') {
                    // Ideally check type "INFO", avoiding "adtl" etc if needed
                    // For now, if "clean", we strip LIST INFO.
                    // To be safe, let's just strip 'LIST' if it contains 'INFO'
                    const listType = String.fromCharCode(view.getUint8(offset + 8), view.getUint8(offset + 9), view.getUint8(offset + 10), view.getUint8(offset + 11));
                    if (listType === 'INFO') {
                        // skip
                    } else {
                        parts.push(buffer.slice(offset, offset + totalChunkSize));
                    }
                } else {
                    parts.push(buffer.slice(offset, offset + totalChunkSize));
                }
            } else if (idStr === 'id3 ' || idStr === 'ID3 ') {
                // WAV can have id3 chunks
                if (mode !== 'keep') {
                    // strip
                } else {
                    parts.push(buffer.slice(offset, offset + totalChunkSize));
                }
            } else {
                parts.push(buffer.slice(offset, offset + totalChunkSize));
            }

            offset += totalChunkSize;
        }

        // Reassemble blob
        // Update RIFF Header size
        const totalSize = parts.reduce((acc, p) => acc + p.byteLength, 0) - 8;
        const finalBlob = new Blob(parts, { type: 'audio/wav' });

        // Patch size in first 12 bytes if strict
        // But Blob implies easy concatenation. We need to patch the first buffer part.
        const headerView = new DataView(parts[0]);
        headerView.setUint32(4, totalSize, true);

        return finalBlob;
    }

    function sanitizeMp3(buffer, mode) {
        // Scan for ID3v2 at start
        const view = new DataView(buffer);
        let startOffset = 0;

        if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2)) === 'ID3') {
            // ID3v2 tag found
            // calculate size
            // Size is 4 bytes (6-9), typically synchsafe integers
            const s1 = view.getUint8(6);
            const s2 = view.getUint8(7);
            const s3 = view.getUint8(8);
            const s4 = view.getUint8(9);
            const tagSize = ((s1 & 0x7f) << 21) | ((s2 & 0x7f) << 14) | ((s3 & 0x7f) << 7) | (s4 & 0x7f);

            if (mode !== 'keep') {
                startOffset = 10 + tagSize; // skip header + tag
            }
        }

        // Handling ID3v1 at end (last 128 bytes)
        let endOffset = buffer.byteLength;
        if (mode !== 'keep') {
            const footer = String.fromCharCode(
                view.getUint8(buffer.byteLength - 128),
                view.getUint8(buffer.byteLength - 127),
                view.getUint8(buffer.byteLength - 126)
            );
            if (footer === 'TAG') {
                endOffset -= 128;
            }
        }

        return new Blob([buffer.slice(startOffset, endOffset)], { type: 'audio/mpeg' });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 60000);
    }

    // ... (rest of helpers like sanitizeFilename, getAuthToken, createStatusUI remain same)

    function extractSongData(row) {
        if (!row) return null;
        try {
            const link = row.querySelector('a[href^="/song/"]');
            if (!link) return null;
            const id = link.getAttribute('href').split('/').pop();
            let title = "";
            const h4 = row.querySelector('h4');
            if (h4) {
                title = h4.innerText;
            } else {
                title = row.innerText.split('\n')[0];
            }
            title = sanitizeFilename(title) || `song-${id}`;
            return { id, title };
        } catch (e) { return null; }
    }

    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, '_').trim();
    }

    function getAuthToken() {
        try {
            const cookies = document.cookie.split('; ');
            const authCookies = cookies.filter(c => c.trim().startsWith('sb-api-auth-token.'));
            if (authCookies.length === 0) return null;
            authCookies.sort();
            const fullValue = authCookies.map(c => c.split('=')[1]).join('');
            const cleanValue = fullValue.replace('base64-', '');
            const sessionData = JSON.parse(atob(cleanValue));
            return sessionData.access_token;
        } catch (e) { return null; }
    }

    function createStatusUI(onCancel) {
        const existing = document.getElementById('wd-ui-root');
        if (existing) existing.remove();

        const root = document.createElement('div');
        root.id = 'wd-ui-root';
        root.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 340px;
            background: white; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            z-index: 10000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            overflow: hidden; border: 1px solid #dcdcdc; opacity: 0; transform: translateY(20px);
            transition: opacity 0.3s, transform 0.3s;
        `;
        requestAnimationFrame(() => {
            root.style.opacity = '1';
            root.style.transform = 'translateY(0)';
        });

        root.innerHTML = `
            <div style="background: #f8f9fa; padding: 12px; border-bottom: 1px solid #eee; position: relative; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #333;">Bulk Downloader</h3>
                    <div style="font-size: 11px; color: #666; margin-top: 4px;">
                        <span id="wd-status">Ready</span> • <span id="wd-counter">0/0</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button id="wd-cancel-btn" style="border: 1px solid #dc3545; background: #fff; color: #dc3545; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Cancel</button>
                    <button id="wd-close-btn" style="border: none; background: transparent; font-size: 18px; color: #999; cursor: pointer; line-height: 1; padding: 0 5px;" title="Close">&times;</button>
                </div>
            </div>
            <div style="padding: 0;">
                <div style="height: 4px; background: #eee; width: 100%;">
                    <div id="wd-progress" style="width: 0%; height: 100%; background: #007bff; transition: width 0.3s ease;"></div>
                </div>
                <div id="wd-logs" style="height: 160px; overflow-y: auto; padding: 10px; font-size: 11px; color: #444;"></div>
            </div>
        `;

        document.body.appendChild(root);

        root.querySelector('#wd-close-btn').onclick = () => {
            root.style.opacity = '0';
            root.style.transform = 'translateY(20px)';
            setTimeout(() => root.remove(), 300);
        };

        const cancelBtn = root.querySelector('#wd-cancel-btn');
        cancelBtn.onclick = () => {
            cancelBtn.innerText = "Stopping...";
            cancelBtn.disabled = true;
            if (onCancel) onCancel();
        };

        const addLog = (msg, type) => {
            const logs = root.querySelector('#wd-logs');
            const line = document.createElement('div');
            line.style.marginBottom = "6px";
            line.style.borderBottom = "1px solid #f5f5f5";
            line.style.paddingBottom = "4px";
            let icon = "ℹ️";
            if (type === 'error') icon = "❌";
            if (type === 'success') icon = "✅";
            if (type === 'download') icon = "⬇️";
            line.innerHTML = `<span style="margin-right:4px;">${icon}</span> ${msg}`;
            logs.prepend(line);
        };

        return {
            updateProgress: (curr, total, status) => {
                const pct = total > 0 ? Math.round((curr / total) * 100) : 0;
                root.querySelector('#wd-progress').style.width = pct + "%";
                root.querySelector('#wd-counter').innerText = `${curr}/${total}`;
                if (status) root.querySelector('#wd-status').innerText = status;
            },
            addLog: addLog,
            markSuccess: (index) => { },
            markFinished: (title) => { addLog(`Finished: ${title}`, "success"); },
            markFail: (index, err) => { addLog(`Error: ${err}`, "error"); },
            showError: (msg) => {
                root.querySelector('#wd-logs').innerHTML = `<div style="color:red; font-weight:bold; padding:5px;">${msg}</div>`;
                root.querySelector('#wd-status').innerText = "Error";
            },
            finish: (success, fail, wasCancelled) => {
                root.querySelector('#wd-status').innerText = wasCancelled ? "Cancelled" : "Done!";
                root.querySelector('#wd-progress').style.background = wasCancelled ? "#dc3545" : "#28a745";
                const btn = document.getElementById('wd-cancel-btn');
                if (btn) btn.remove();
            }
        };
    }
})();
