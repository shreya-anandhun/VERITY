/* =========================================================
   VERITY — app.js
   ========================================================= */

/* ---------- HOME DATA ---------- */
// Filled from the contract once wiring is done; null = nothing live yet
let featuredPoll = null;
let livePollCount = 0;

const SEPOLIA_CHAIN_ID = "0xaa36a7";   // Sepolia's network ID (11155111) in hex

// Your deployed Voting contract (paste the full address from Remix here)
const CONTRACT_ADDRESS = "0x90498Ad55b09c2b07d51e2aF703c539286F28f1d";

let walletReady = false;   // true once we know whether a wallet was already connected


/* ---------- 0. Settings (saved in this browser) ---------- */
function getSetting(key, fallback) {
    try {
        const v = localStorage.getItem("verity-" + key);
        return v === null ? fallback : JSON.parse(v);
    } catch (err) { return fallback; }
}
function setSetting(key, value) {
    try { localStorage.setItem("verity-" + key, JSON.stringify(value)); } catch (err) {}
}
// Light or dark: sets data-theme on <html>, which style.css reads
function applyTheme() {
    let t = getSetting("theme", "dark");
    if (t === "system") t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = t;
}
applyTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);


/* ---------- 1. Sidebar toggle (phones) ---------- */
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");

document.getElementById("menuBtn").addEventListener("click", (e) => {
    e.preventDefault();
    sidebar.classList.add("open");
    overlay.classList.add("show");
});
overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
});


// Escape closes whatever popup is open
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelectorAll(".welcome-backdrop:not(.hidden)");
    if (open.length) e.closedPopup = true;
    open.forEach((m) => m.classList.add("hidden"));
    const pp = document.getElementById("profilePanel");
    if (pp) pp.classList.remove("open");
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
});

// "1 poll" / "2 polls"
function plural(n, word) { return `${n} ${word}${Number(n) === 1 ? "" : "s"}`; }


/* ---------- 2. Profile panel ---------- */
const profileBtn   = document.getElementById("profileBtn");
const profilePanel = document.getElementById("profilePanel");

profileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    profilePanel.classList.toggle("open");
    profileBtn.setAttribute("aria-expanded", profilePanel.classList.contains("open"));
});
// close when clicking anywhere else
document.addEventListener("click", (e) => {
    if (!profilePanel.contains(e.target)) profilePanel.classList.remove("open");
});

// Name: saved only in this browser (localStorage)
function getName() {
    try { return localStorage.getItem("verity-name") || ""; } catch (err) { return ""; }
}
function saveName(name) {
    try { localStorage.setItem("verity-name", name); } catch (err) {}
}

const nameInput = document.getElementById("displayName");
nameInput.value = getName();
nameInput.addEventListener("input", () => {
    saveName(nameInput.value.trim());
    showGreeting();          // greeting updates as you edit your name
});


/* ---------- 2b. Daily welcome message ---------- */
// <user> gets replaced with the person's first name
const greetings = {
    0: [ // Sunday
        "A little peace before the next adventure, <user>.",
        "Reset, recharge, repeat, <user>.",
        "Sundays are for new perspectives, <user>.",
        "Take a breath, <user>. You've earned it."
    ],
    1: [ // Monday
        "New week. New energy. Let's get into it, <user>.",
        "Mondays aren't so bad when you're here, <user>.",
        "Fresh start. Same great you, <user>.",
        "Time to make this week count, <user>."
    ],
    2: [ // Tuesday
        "Tuesday looks better with you around, <user>.",
        "Keep the energy going, <user>!",
        "Another day, another possibility, <user>.",
        "You're doing better than you think, <user>!"
    ],
    3: [ // Wednesday
        "Halfway there, <user>. Keep shining.",
        "Midweek check-in: you're doing great, <user>!",
        "A little progress goes a long way, <user>.",
        "Make today worth remembering, <user>."
    ],
    4: [ // Thursday
        "Almost there, <user>. Don't lose the spark.",
        "Good things are taking shape, <user>.",
        "Thursday called. It said keep going, <user>.",
        "You're right where you need to be, <user>."
    ],
    5: [ // Friday
        "It's Friday, <user>. Make it count.",
        "Main character energy. All day, <user>.",
        "End the week on your own terms, <user>.",
        "Friday feels a little more exciting with you, <user>."
    ],
    6: [ // Saturday
        "Slow down. Show up. Enjoy the moment, <user>.",
        "Your weekend starts here, <user>.",
        "Today has potential, <user>. Go explore it.",
        "No rush, <user>. Just good vibes."
    ]
};
const bonusGreetings = [
    "You're back, <user>! We saved you a little magic.",
    "The world is yours to explore, <user>. Let's go."
];

function showGreeting() {
    const today = new Date();
    // Today's options = that weekday's 4 messages + the 2 bonus ones
    const options = greetings[today.getDay()].concat(bonusGreetings);

    // Same message all day; a new one each day (number of days since 1970)
    const dayNumber = Math.floor((today.getTime() - today.getTimezoneOffset() * 60000) / 86400000);
    const message = options[dayNumber % options.length];

    const name = getName();
    const el = document.getElementById("cardGreeting");
    if (!el) return;                       // not every page has the greeting
    if (name) {
        el.innerHTML = message.replace("<user>", "<b>" + escapeHTML(name) + "</b>");
    } else {
        // no name yet: remove the placeholder neatly
        el.textContent = message.replace(/,? <user>/, "");
    }
}

// stops someone typing HTML code as their name
function escapeHTML(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
showGreeting();


/* ---------- 3. Line-art waves on the wallet card ---------- */
function drawCardWaves() {
    const svg = document.getElementById("cardWaves");
    if (!svg) return;                      // only the Home page has the wallet card
    const ns = "http://www.w3.org/2000/svg";

    // gradient: mint -> sky -> lavender
    svg.innerHTML = `
        <defs>
            <linearGradient id="waveGrad" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%"   stop-color="#BBFFD8"/>
                <stop offset="55%"  stop-color="#7AB4EC"/>
                <stop offset="100%" stop-color="#BDB8E7"/>
            </linearGradient>
        </defs>`;

    for (let i = 0; i < 22; i++) {
        const path = document.createElementNS(ns, "path");
        const d = `M 430 ${-30 + i * 7}
                   C ${350 - i * 3} ${50 + i * 5},
                     ${300 + i * 2} ${150 + i * 2},
                     ${190 + i * 9} 280`;
        path.setAttribute("d", d);
        path.setAttribute("stroke", "url(#waveGrad)");
        path.setAttribute("opacity", (0.25 + (i / 22) * 0.6).toFixed(2));
        svg.appendChild(path);
    }
}
drawCardWaves();


/* ---------- 4. Featured poll + live count ---------- */
const pollCard  = document.getElementById("featuredPoll");
const emptyPoll = document.getElementById("emptyPoll");

if (pollCard && emptyPoll) {
    if (!featuredPoll) {
        pollCard.classList.add("hidden");
        emptyPoll.classList.remove("hidden");
    } else {
        document.getElementById("pollQuestion").textContent = featuredPoll.question;
        document.getElementById("voterCount").textContent = featuredPoll.voters.toLocaleString("en-IN");
    }
    document.getElementById("liveCount").textContent = livePollCount;
}

// Countdown, updated every second
// Turns milliseconds into "2d 13h 59m 58s" (shared by every page)
function formatTimeLeft(ms) {
    if (ms <= 0) return "Ended";
    const d = Math.floor(ms / 86400000);
    const h = Math.floor(ms / 3600000) % 24;
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function updateCountdown() {
    const el = document.getElementById("timeLeft");
    if (!el || !featuredPoll) return;
    el.textContent = formatTimeLeft(featuredPoll.endTime - Date.now());
}
updateCountdown();
setInterval(updateCountdown, 1000);


/* ---------- 5. Connect Phantom wallet ---------- */
const connectBtn = document.getElementById("connectBtn");

// Finding the wallets in this browser: Phantom and MetaMask.
// Wallets announce themselves through EIP-6963 (the modern way), and older
// setups also put themselves on window.phantom / window.ethereum. We check all of them.
const WALLETS = {
    phantom:  { name: "Phantom",  download: "https://phantom.com/download",  rdns: /phantom/i },
    metamask: { name: "MetaMask", download: "https://metamask.io/download/", rdns: /metamask/i }
};
const announced = {};
window.addEventListener("eip6963:announceProvider", (e) => {
    const d = e.detail || {};
    const info = d.info || {};
    for (const key in WALLETS) {
        if (WALLETS[key].rdns.test((info.rdns || "") + " " + (info.name || "")) && d.provider) announced[key] = d.provider;
    }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

// The provider object for one wallet, or null if it isn't installed here
function findWallet(key) {
    if (announced[key]) return announced[key];
    const eth = window.ethereum;
    const list = eth ? (Array.isArray(eth.providers) ? eth.providers : [eth]) : [];
    if (key === "phantom") {
        if (window.phantom && window.phantom.ethereum) return window.phantom.ethereum;
        return list.find((p) => p && p.isPhantom) || null;
    }
    // Phantom also says "isMetaMask" for compatibility, so rule it out
    return list.find((p) => p && p.isMetaMask && !p.isPhantom && !p.isBraveWallet) || null;
}

// Which wallet the person picked (remembered on this device)
function chosenWallet() {
    let k = null;
    try { k = localStorage.getItem("verity-wallet"); } catch (err) {}
    if (k && findWallet(k)) return k;
    if (findWallet("phantom")) return "phantom";
    if (findWallet("metamask")) return "metamask";
    return k || "phantom";
}
function getProvider() { return findWallet(chosenWallet()); }
function walletName() { return WALLETS[chosenWallet()].name; }

function shortAddress(addr) {
    try { if (window.ethers) addr = ethers.getAddress(addr); } catch (err) {}   // same capitalisation everywhere
    return addr.slice(0, 6) + " •••• " + addr.slice(-4);
}

// Copy text, with a fallback for browsers that block the clipboard API
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) {}
    try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        return true;
    } catch (err) { return false; }
}

// The address that's currently connected ("" when not connected)
let currentAccount = "";

// Small helper: set text on an element only if it exists on this page
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

async function showConnected(address) {
    const provider = getProvider();
    currentAccount = address;

    const dis = document.getElementById("cardDisconnected");
    const con = document.getElementById("cardConnected");
    if (dis) dis.classList.add("hidden");
    if (con) con.classList.remove("hidden");

    setText("cardAddress", shortAddress(address));
    document.querySelectorAll(".pp-stats").forEach((el) => el.classList.remove("hidden"));
    setText("ppAddress", shortAddress(address));
    const votes = document.getElementById("ppVotes");
    if (votes) votes.innerHTML = '<li class="muted">No votes yet</li>';

    // Wallet chip on other pages
    const chip = document.getElementById("walletChip");
    if (chip) chip.innerHTML = '<span class="status-dot"></span> ' + shortAddress(address);

    // Profile panel button becomes "Disconnect"
    const ppBtn = document.getElementById("ppWalletBtn");
    if (ppBtn) { ppBtn.textContent = "Sign out"; ppBtn.classList.add("disconnect"); }

    // Balance comes back in "wei" (1 ETH = 10^18 wei), as a hex string
    try {
        const weiHex = await provider.request({ method: "eth_getBalance", params: [address, "latest"] });
        const eth = Number(BigInt(weiHex)) / 1e18;
        setText("cardBalance", eth.toFixed(3) + " ETH");
    } catch (err) {
        console.log("Could not read balance", err);
    }

    // Let other scripts (like live.js) know
    document.dispatchEvent(new CustomEvent("wallet-connected", { detail: { address } }));
}

// Put the page back to the "not connected" look
function showDisconnected() {
    currentAccount = "";

    const dis = document.getElementById("cardDisconnected");
    const con = document.getElementById("cardConnected");
    if (dis) dis.classList.remove("hidden");
    if (con) con.classList.add("hidden");

    setText("ppAddress", "Wallet not connected");
    setText("statVoted", "0");
    setText("statCreated", "0");
    document.querySelectorAll(".pp-stats").forEach((el) => el.classList.add("hidden"));   // no "0 polls voted" before you've connected
    const votes = document.getElementById("ppVotes");
    if (votes) votes.innerHTML = '<li class="muted">Connect your wallet to see your votes</li>';

    const chip = document.getElementById("walletChip");
    if (chip) chip.innerHTML = '<span class="status-dot dim"></span> Wallet not connected';

    const ppBtn = document.getElementById("ppWalletBtn");
    if (ppBtn) { ppBtn.textContent = "Connect Wallet"; ppBtn.classList.remove("disconnect"); }

    document.dispatchEvent(new CustomEvent("wallet-disconnected"));
}

// Phones: Safari and Chrome can't talk to a wallet app. The page has to be opened
// INSIDE the Phantom app's own browser, and this link does exactly that.
const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function phantomAppLink() {
    return "https://phantom.app/ul/browse/" + encodeURIComponent(location.href) + "?ref=" + encodeURIComponent(location.origin);
}
function metamaskAppLink() {
    return "https://metamask.app.link/dapp/" + location.host + location.pathname + location.search;
}
function appLink(key) { return key === "metamask" ? metamaskAppLink() : phantomAppLink(); }

async function connectWallet(key) {
    key = key || chosenWallet();
    const provider = findWallet(key);

    // That wallet isn't here? On a phone, reopen this page inside the wallet's app. On a computer, go and install it.
    if (!provider) {
        if (isPhone) location.href = appLink(key);
        else window.open(WALLETS[key].download, "_blank");
        return;
    }
    try { localStorage.setItem("verity-wallet", key); } catch (err) {}
    listenToWallet(provider);

    // They chose to connect, so forget any earlier "Disconnect"
    try { localStorage.removeItem("verity-disconnected"); } catch (err) {}

    if (connectBtn) connectBtn.disabled = true;
    try {
        // 1. Ask Phantom to connect -> Phantom popup appears
        const accounts = await provider.request({ method: "eth_requestAccounts" });

        // 2. Make sure we're on Sepolia
        try {
            await provider.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: SEPOLIA_CHAIN_ID }]
            });
        } catch (err) {
            console.log("Network switch skipped:", err.message);
        }

        await showConnected(accounts[0]);
    } catch (err) {
        console.log("Connection cancelled:", err.message);
    } finally {
        if (connectBtn) connectBtn.disabled = false;
    }
}
// Disconnect = VERITY forgets the wallet. Phantom itself stays logged in;
// fully removing the site is done inside Phantom (Connected apps).
// Sign out = VERITY forgets the wallet AND the display name (theme and settings stay).
// Phantom itself keeps its own memory of the site; fully removing VERITY is done inside Phantom.
async function disconnectWallet() {
    const provider = getProvider();
    try {
        // Newer wallets let a site give back its permission
        if (provider && currentAccount) await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch (err) {}
    try {
        localStorage.setItem("verity-disconnected", "1");
        localStorage.removeItem("verity-wallet");          // next time, choose a wallet again
        localStorage.removeItem("verity-name");
        sessionStorage.removeItem("verity-welcomed");
    } catch (err) {}
    if (nameInput) nameInput.value = "";
    showDisconnected();
    showGreeting();
    updateSignOutLink();
    profilePanel.classList.remove("open");
    toast("Signed out. See you next time.", "");
}


/* ---------- 5b. Connect-wallet popup ---------- */
const connectModal = document.getElementById("connectModal");

function openConnectModal() {
    if (!connectModal) return;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    let anyInstalled = false;
    for (const key in WALLETS) {
        const here = !!findWallet(key);
        anyInstalled = anyInstalled || here;
        const btn = connectModal.querySelector(`[data-wallet="${key}"]`);
        const status = connectModal.querySelector(`[data-wallet-status="${key}"]`);
        if (btn) btn.classList.toggle("installed", here);
        if (status) status.textContent = here
            ? "Found in this browser. Click to connect."
            : isPhone ? `Opens this page inside the ${WALLETS[key].name} app`
            : `Not installed. Click to get it free, then come back.`;
    }
    const intro = document.getElementById("connectIntro");
    const title = document.getElementById("connectTitle");
    const note = document.getElementById("connectNoExt");
    if (!anyInstalled && isPhone) {
        if (title) title.textContent = "Voting from your phone?";
        if (intro) intro.textContent = "Phone browsers can't reach a wallet app. Pick your wallet and this page reopens inside it, where you can connect and vote.";
        if (note) note.textContent = "No wallet app yet? Phantom and MetaMask are both free in the App Store and Google Play.";
        const bar = document.getElementById("phoneBar");
        if (bar) bar.remove();
    } else if (note) {
        note.textContent = anyInstalled
            ? "Using both? Pick the one you want to vote with. You can switch later by signing out."
            : "New to wallets? Both are free. Install one, come back to this page, and connect.";
    }
    profilePanel.classList.remove("open");
    connectModal.classList.remove("hidden");
}
function closeConnectModal() { if (connectModal) connectModal.classList.add("hidden"); }
function refreshWalletNames() {
    const name = walletName();
    document.querySelectorAll("[data-wallet-name]").forEach((el) => el.textContent = name);
}
refreshWalletNames();
document.addEventListener("wallet-ready", refreshWalletNames);

if (connectModal) {
    connectModal.querySelectorAll("[data-wallet]").forEach((btn) => btn.addEventListener("click", () => {
        closeConnectModal();
        connectWallet(btn.dataset.wallet);
    }));
    document.getElementById("connectCancel").addEventListener("click", closeConnectModal);
    connectModal.addEventListener("click", (e) => { if (e.target === connectModal) closeConnectModal(); });
}

// Big "Connect Wallet" on the Home card
if (connectBtn) connectBtn.addEventListener("click", openConnectModal);

// Secondary "Sign out" link: shown whenever a name is saved but no wallet is connected
function updateSignOutLink() {
    const el = document.getElementById("ppSignOut");
    if (el) el.classList.toggle("hidden", !(getName() && !currentAccount));
}
const ppSignOut = document.getElementById("ppSignOut");
if (ppSignOut) ppSignOut.addEventListener("click", disconnectWallet);
document.addEventListener("wallet-connected", updateSignOutLink);
document.addEventListener("wallet-disconnected", updateSignOutLink);
document.addEventListener("wallet-ready", updateSignOutLink);
if (nameInput) nameInput.addEventListener("input", updateSignOutLink);

// Button in the profile panel: connect or disconnect
const ppWalletBtn = document.getElementById("ppWalletBtn");
if (ppWalletBtn) {
    ppWalletBtn.addEventListener("click", () => {
        if (currentAccount) disconnectWallet();
        else openConnectModal();
    });
}


/* ---------- 6. First-visit welcome popup ---------- */
const welcomeModal = document.getElementById("welcomeModal");

// Only on the Home page, and only if we don't know their name yet
if (welcomeModal) {

/* Splash: white screen with VERITY, once per browser session, then swoosh away */
const splash = document.getElementById("splash");
let seenSplash = false;
try { seenSplash = sessionStorage.getItem("verity-splash") === "1"; } catch (err) {}

// After the splash: ask for a name if we don't have one; otherwise, if the
// wallet isn't connected, greet them by name and offer to connect.
function showWelcomeIfNeeded() {
    const decide = () => {
        if (!getName()) {
            welcomeModal.classList.remove("hidden");
        } else if (!currentAccount && !sessionStorage.getItem("verity-welcomed")) {
            document.getElementById("welcomeHello").textContent = `Welcome back, ${getName()}!`;
            document.getElementById("welcomeStep1").classList.add("hidden");
            document.getElementById("welcomeStep2").classList.remove("hidden");
            welcomeModal.classList.remove("hidden");
        }
    };
    // Wait until we know whether Phantom is already connected
    if (walletReady) decide(); else document.addEventListener("wallet-ready", decide, { once: true });
}
// Home boxes slide in from the sides every time the page is shown
function animateHome() {
    const home = document.querySelector(".content.home");
    if (!home) return;
    home.classList.remove("enter");
    void home.offsetWidth;                                 // restart the animation
    home.classList.add("enter");
}
if (splash && !seenSplash) {
    try { sessionStorage.setItem("verity-splash", "1"); } catch (err) {}
    setTimeout(() => {
        splash.classList.add("out");                       // swoosh animation
        animateHome();
        setTimeout(() => { splash.remove(); showWelcomeIfNeeded(); }, 750);
    }, 1400);
} else {
    if (splash) splash.remove();
    animateHome();
    showWelcomeIfNeeded();
}
// Also replay when coming back via the browser's back/forward cache
window.addEventListener("pageshow", (e) => { if (e.persisted) animateHome(); });

document.getElementById("nameForm").addEventListener("submit", (e) => {
    e.preventDefault();                       // stop the page reloading
    const first = document.getElementById("firstNameInput").value.trim();
    if (!first) return;

    saveName(first);
    nameInput.value = first;
    showGreeting();
    updateSignOutLink();

    document.getElementById("welcomeHello").textContent = `Lovely to meet you, ${first}!`;
    document.getElementById("welcomeStep1").classList.add("hidden");
    document.getElementById("welcomeStep2").classList.remove("hidden");
});

function closeWelcome() {
    welcomeModal.classList.add("hidden");
    try { sessionStorage.setItem("verity-welcomed", "1"); } catch (err) {}   // don't nag again this session
}

document.getElementById("welcomeConnect").addEventListener("click", () => {
    closeWelcome();
    // Once the wallet connects from here, offer the demo (same popup, step 3)
    let offered = false;
    try { offered = localStorage.getItem("verity-tour-offered") === "1"; } catch (err) {}
    if (!offered) document.addEventListener("wallet-connected", offerTour, { once: true });
    openConnectModal();
});
document.getElementById("welcomeLater").addEventListener("click", closeWelcome);

function offerTour() {
    try { localStorage.setItem("verity-tour-offered", "1"); } catch (err) {}   // ask once per device
    const name = getName();
    document.getElementById("welcomeTourTitle").textContent = name ? `You're all set, ${name}!` : "You're all set!";
    document.getElementById("welcomeStep1").classList.add("hidden");
    document.getElementById("welcomeStep2").classList.add("hidden");
    document.getElementById("welcomeStep3").classList.remove("hidden");
    setTimeout(() => welcomeModal.classList.remove("hidden"), 350);            // let the connect popup close first
}
document.getElementById("welcomeTourNo").addEventListener("click", () => {
    welcomeModal.classList.add("hidden");
    document.getElementById("welcomeStep3").classList.add("hidden");
});
} // end of Home-only welcome code

// Phone browser with no wallet: a bar at the bottom offers to reopen the page in the Phantom app
function showPhoneBar() {
    if (!isPhone || getProvider() || document.getElementById("phoneBar")) return;
    try { if (sessionStorage.getItem("verity-phonebar") === "1") return; } catch (err) {}
    const bar = document.createElement("div");
    bar.id = "phoneBar";
    bar.className = "phone-bar";
    bar.innerHTML = '<span><b>To vote on your phone</b>open this page inside your wallet app.</span>' +
        '<a class="phone-bar-btn" href="' + phantomAppLink() + '">Phantom</a>' +
        '<a class="phone-bar-btn alt" href="' + metamaskAppLink() + '">MetaMask</a>' +
        '<button class="phone-bar-x" aria-label="Dismiss">✕</button>';
    bar.querySelector("button").addEventListener("click", () => {
        bar.remove();
        try { sessionStorage.setItem("verity-phonebar", "1"); } catch (err) {}
    });
    document.body.appendChild(bar);
}

// Switched account inside the wallet? Update the page. (Only listen to each wallet once.)
const listening = new Set();
function listenToWallet(provider) {
    if (!provider || !provider.on || listening.has(provider)) return;
    listening.add(provider);
    provider.on("accountsChanged", (accounts) => {
        if (provider !== getProvider()) return;
        if (accounts.length && currentAccount) showConnected(accounts[0]);
        else if (!accounts.length) showDisconnected();
    });
}

// If they connected before, show it straight away (no popup)
(async () => {
    const provider = getProvider();
    if (!provider) { walletReady = true; document.dispatchEvent(new Event("wallet-ready")); setTimeout(showPhoneBar, 600); return; }

    // Did they press Disconnect last time? Then stay disconnected.
    let forgot = false;
    try { forgot = localStorage.getItem("verity-disconnected") === "1"; } catch (err) {}

    if (!forgot) {
        try {
            const accounts = await provider.request({ method: "eth_accounts" });
            if (accounts.length) showConnected(accounts[0]);
        } catch (err) {}
    }

    walletReady = true;
    document.dispatchEvent(new Event("wallet-ready"));

    listenToWallet(provider);
})();
