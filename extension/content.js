chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_THEME') {
        if (msg.theme === 'default') {
            document.body.removeAttribute('data-pai-theme');
        } else {
            document.body.setAttribute('data-pai-theme', msg.theme);
        }
    }
    } else if (msg.type === 'SCROLL_TO_BOTTOM') {
        const scrollToBottom = () => {
            const distance = 1000;
            const delay = 500;
            let lastScrollHeight = document.body.scrollHeight;
            let checks = 0;

            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                
                // check if new content loaded
                if (document.body.scrollHeight > lastScrollHeight) {
                    lastScrollHeight = document.body.scrollHeight;
                    checks = 0; // reset check count
                } else {
                    checks++;
                }

                // stop if no new content after 5 checks (2.5 seconds)
                if (checks >= 5) {
                    clearInterval(timer);
                    alert("Reached the bottom or no more items loading.");
                }
            }, delay);
        };
        scrollToBottom();
    }
});
