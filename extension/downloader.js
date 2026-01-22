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

        // handle special formats
        if (fileExt === 'stems') {
            urlFormat = 'stems'; // individual stems
        } else if (fileExt === 'stems_zip') {
            fileExt = 'zip';
            urlFormat = 'stems_zip';
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

                    // queue downloads
                    for (const stemName of stemKeys) {
                        const base64Data = data.stems[stemName];
                        if (!base64Data) continue;

                        const stemFilename = `${folderPrefix}${song.title}_Stems/${stemName}.m4a`;
                        const dataUri = `data:audio/mp4;base64,${base64Data}`;

                        chrome.runtime.sendMessage({
                            type: "DOWNLOAD",
                            url: dataUri,
                            filename: stemFilename
                        }, (response) => {
                            if (response && response.success) {
                                pendingDownloads.set(response.downloadId, `${song.title} (${stemName})`);
                            } else {
                                ui.addLog(`Failed: ${stemName}`, "error");
                            }
                        });
                        await new Promise(r => setTimeout(r, 200));
                    }
                    ui.markSuccess(index);
                    successCount++;

                } else if (urlFormat === 'stems_zip') {
                    // --- handle stems (zip) ---
                    ui.addLog(`Fetching stems info: ${song.title}`, "download");
                    const response = await fetch(`https://www.producer.ai/__api/stems/${song.id}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!response.ok) throw new Error(`Stems API Error: ${response.status}`);

                    const data = await response.json();
                    if (!data.stems) throw new Error("No stems found");
                    const stemKeys = Object.keys(data.stems);

                    ui.addLog(`Zipping ${stemKeys.length} stems...`, "info");
                    const zip = new JSZip();
                    const folder = zip.folder(`${song.title}_Stems`);

                    for (const stemName of stemKeys) {
                        const base64Data = data.stems[stemName];
                        if (base64Data) {
                            folder.file(`${stemName}.m4a`, base64Data, { base64: true });
                        }
                    }

                    const content = await zip.generateAsync({ type: "blob" });
                    const zipUrl = URL.createObjectURL(content);
                    const zipFilename = `${folderPrefix}${song.title}_Stems.zip`;

                    // Trigger local download (Blob URL)
                    const a = document.createElement('a');
                    a.href = zipUrl;
                    a.download = zipFilename;
                    document.body.appendChild(a);
                    a.click();

                    ui.markSuccess(index);
                    ui.markFinished(`${song.title} (ZIP)`); // Mark finished immediately
                    successCount++;

                    // cleanup
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(zipUrl);
                    }, 60000);

                } else if (urlFormat.startsWith('tracks_zip')) {
                    // --- handle tracks (zip) ---
                    const subFormat = urlFormat.replace('tracks_zip_', '') || 'wav';

                    ui.addLog(`Fetching ${subFormat.toUpperCase()} for Zip: ${song.title}`, "download");
                    const trackUrl = `https://www.producer.ai/__api/${song.id}/download?format=${subFormat}`;

                    const response = await fetch(trackUrl, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!response.ok) throw new Error(`Fetch Error: ${response.status}`);
                    const blob = await response.blob();

                    ui.addLog(`Zipping track...`, "info");
                    const zip = new JSZip();
                    zip.file(`${song.title}.${subFormat}`, blob);

                    const content = await zip.generateAsync({ type: "blob" });
                    const zipUrl = URL.createObjectURL(content);
                    const zipFilename = `${folderPrefix}${song.title}.zip`;

                    // Trigger local download (Blob URL)
                    const a = document.createElement('a');
                    a.href = zipUrl;
                    a.download = zipFilename;
                    document.body.appendChild(a);
                    a.click();

                    ui.markSuccess(index);
                    ui.markFinished(`${song.title} (ZIP)`);
                    successCount++;

                    // cleanup
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(zipUrl);
                    }, 60000);

                } else {
                    // --- handle regular audio ---
                    const filename = `${folderPrefix}${song.title}.${fileExt}`;
                    let downloadUrl = `https://www.producer.ai/__api/${song.id}/download?format=${urlFormat}`;

                    ui.addLog(`Queueing: ${song.title}`, "download");

                    chrome.runtime.sendMessage({
                        type: "DOWNLOAD",
                        url: downloadUrl,
                        filename: filename,
                        headers: [
                            { name: "Authorization", value: `Bearer ${token}` }
                        ]
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            ui.markFail(index, chrome.runtime.lastError.message);
                            failCount++;
                        } else if (response && response.success) {
                            pendingDownloads.set(response.downloadId, song.title);
                            ui.markSuccess(index);
                            successCount++;
                        } else {
                            ui.markFail(index, response?.error || "Extension Communication Error");
                            failCount++;
                        }
                    });
                }

                // small delay
                if (urlFormat !== 'stems') {
                    await new Promise(r => setTimeout(r, 600));
                }

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

    // --- helpers ---

    function extractSongData(row) {
        if (!row) return null;
        try {
            const link = row.querySelector('a[href^="/song/"]');
            if (!link) return null;

            const id = link.getAttribute('href').split('/').pop();

            // title extraction
            let title = "";
            const h4 = row.querySelector('h4');
            if (h4) {
                title = h4.innerText;
            } else {
                // fallback: first line of row text
                title = row.innerText.split('\n')[0];
            }

            title = sanitizeFilename(title) || `song-${id}`;
            return { id, title };
        } catch (e) {
            console.error("Extraction error", e);
            return null;
        }
    }

    function sanitizeFilename(name) {
        // remove illegal chars
        return name.replace(/[<>:"/\\|?*]/g, '_').trim();
    }

    function sendMessageToBackground(msg) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage(msg, response => {
                resolve(response || { success: false, error: "No response" });
            });
        });
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

        // animate in
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
                    <button id="wd-cancel-btn" style="
                        border: 1px solid #dc3545; background: #fff; color: #dc3545; 
                        padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;
                    ">Cancel</button>

                    <button id="wd-close-btn" style="
                        border: none; background: transparent; font-size: 18px; color: #999; 
                        cursor: pointer; line-height: 1; padding: 0 5px;
                    " title="Close">&times;</button>
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
            markSuccess: (index) => {
                addLog("Download Started", "info");
            },
            markFinished: (title) => {
                addLog(`Finished: ${title}`, "success");
            },
            markFail: (index, err) => {
                addLog(`Error: ${err}`, "error");
            },
            showError: (msg) => {
                root.querySelector('#wd-logs').innerHTML = `<div style="color:red; font-weight:bold; padding:5px;">${msg}</div>`;
                root.querySelector('#wd-status').innerText = "Error";
            },
            finish: (success, fail, wasCancelled) => {
                root.querySelector('#wd-status').innerText = wasCancelled ? "Cancelled" : "Done!";
                root.querySelector('#wd-progress').style.background = wasCancelled ? "#dc3545" : "#28a745"; // red or green
                // remove cancel button when done
                const btn = document.getElementById('wd-cancel-btn');
                if (btn) btn.remove();
            }
        };
    }
})();
