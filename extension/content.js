chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_THEME') {
        if (msg.theme === 'default') {
            document.body.removeAttribute('data-pai-theme');
        } else {
            document.body.setAttribute('data-pai-theme', msg.theme);
        }
    }
});
