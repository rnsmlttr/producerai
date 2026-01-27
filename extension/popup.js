console.log("Popup script loaded.");

function getElement(id) {
    const el = document.getElementById(id);
    if (!el) console.error(`Element not found: ${id}`);
    return el;
}

const btnDownload = getElement('downloadBtn');
if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
        console.log("Download button clicked");
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // check domain
        if (tab.url && tab.url.includes("producer.ai")) {
            const mode = document.getElementById('downloadMode').value;
            const folder = document.getElementById('folderMode').value;
            const format = document.getElementById('formatMode').value;
            const meta = document.getElementById('metadataMode').value;

            // inject script
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['jszip.min.js', 'downloader.js']
            });

            // delay for listener attachment
            setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, {
                    type: "INIT_DOWNLOADER",
                    config: { mode, folder, format, meta }
                });
            }, 100);

            // update ui
            const btn = document.getElementById('downloadBtn');
            btn.innerText = "🚀 Process Started!";
            btn.style.backgroundColor = "#28a745"; // green
            btn.disabled = true;

            setTimeout(() => {
                window.close();
            }, 1200);
        } else {
            alert("Please navigate to a Producer.ai page first.");
        }
    });
}

const selTheme = getElement('themeMode');
if (selTheme) {
    selTheme.addEventListener('change', async (e) => {
        console.log("Theme changed");
        const theme = e.target.value;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab.url && tab.url.includes("producer.ai")) {
            chrome.tabs.sendMessage(tab.id, {
                type: "SET_THEME",
                theme: theme
            }).catch(() => {
                // if content script isn't loaded yet
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                }).then(() => {
                    chrome.tabs.sendMessage(tab.id, { type: "SET_THEME", theme: theme });
                });
                chrome.scripting.insertCSS({
                    target: { tabId: tab.id },
                    files: ['styles.css']
                });
            });
        }
    });
}



const btnSearch = getElement('searchBtn');
if (btnSearch) {
    btnSearch.addEventListener('click', async () => {
        console.log("Search clicked");
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab.url && tab.url.includes("producer.ai")) {
            // ensure script is injected
            chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] }).catch(() => { });

            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            }).then(() => {
                chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SEARCH" });
                window.close();
            }).catch(() => {
                chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SEARCH" });
                window.close();
            });
        } else {
            alert("Please navigate to a Producer.ai page first.");
        }
    });
}
