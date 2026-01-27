chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "DOWNLOAD") {
        try {
            chrome.downloads.download({
                url: request.url,
                filename: request.filename,
                headers: request.headers,
                conflictAction: 'uniquify',
                saveAs: false
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error("Download failed:", chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ success: true, downloadId: downloadId });
                }
            });
        } catch (e) {
            console.error("Sync Download Error:", e);
            sendResponse({ success: false, error: e.message });
            return false;
        }

        return true; // async response
    }
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === "complete") {
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, {
                    type: "DOWNLOAD_COMPLETE",
                    downloadId: delta.id
                }).catch(() => {
                    // ignore active tab errors
                });
            }
        });
    }
});
