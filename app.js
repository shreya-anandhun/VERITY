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
    document.documentElement.dataset.theme = getSetting("theme", "light");
}
applyTheme();


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
        "A little peace before the next adventure <user>.",
        "Reset, recharge, repeat <user>.",
        "Sundays are for new perspectives <user>.",
        "Take a breath <user>. You've earned it."
    ],
    1: [ // Monday
        "New week. New energy. Let's get into it <user>.",
        "Mondays aren't so bad when you're here <user>.",
        "Fresh start. Same great you, <user>.",
        "Time to make this week count, <user>."
    ],
    2: [ // Tuesday
        "Tuesday looks better with you around <user>.",
        "Keep the energy going <user>!",
        "Another day, another possibility <user>.",
        "You're doing better than you think <user>!"
    ],
    3: [ // Wednesday
        "Halfway there <user>. Keep shining.",
        "Midweek check-in: you're doing great <user>!",
        "A little progress goes a long way <user>.",
        "Make today worth remembering <user>."
    ],
    4: [ // Thursday
        "Almost there <user>. Don't lose the spark.",
        "Good things are taking shape <user>.",
        "Thursday called. It said keep going, <user>.",
        "You're right where you need to be, <user>."
    ],
    5: [ // Friday
        "It's Friday <user>. Make it count.",
        "Main character energy. All day <user>.",
        "End the week on your own terms <user>.",
        "Friday feels a little more exciting with you <user>."
    ],
    6: [ // Saturday
        "Slow down. Show up. Enjoy the moment <user>.",
        "Your weekend starts here <user>.",
        "Today has potential <user>. Go explore it.",
        "No rush <user>. Just good vibes."
    ]
};
const bonusGreetings = [
    "You're back <user>! We saved you a little magic.",
    "The world is yours to explore <user>. Let's go."
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

if (pollCard) {
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

// Finding Phantom's Ethereum connection.
// Phantom usually puts it at window.phantom.ethereum, but depending on the
// browser and Phantom's settings it can also show up as window.ethereum or
// announce itself through the EIP-6963 "announceProvider" event. We check all three.
let announcedPhantom = null;
window.addEventListener("eip6963:announceProvider", (e) => {
    const info = e.detail && e.detail.info;
    if (info && /phantom/i.test(info.name || "") && e.detail.provider) announcedPhantom = e.detail.provider;
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

// Which wallet is installed? Phantom is recommended, MetaMask also works.
function walletName() {
    const p = getProvider();
    if (!p) return "Phantom";
    if (p.isMetaMask && !p.isPhantom) return "MetaMask";
    return "Phantom";
}

function getProvider() {
    if (window.phantom && window.phantom.ethereum) return window.phantom.ethereum;
    if (announcedPhantom) return announcedPhantom;
    const eth = window.ethereum;
    if (eth) {
        if (eth.isPhantom) return eth;
        if (Array.isArray(eth.providers)) {
            const p = eth.providers.find((x) => x.isPhantom) || eth.providers.find((x) => x.isMetaMask);
            if (p) return p;
        }
        if (eth.isMetaMask) return eth;      // no Phantom, but MetaMask is here: use it
    }
    return null;
}

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
    const votes = document.getElementById("ppVotes");
    if (votes) votes.innerHTML = '<li class="muted">Connect your wallet to see your votes</li>';

    const chip = document.getElementById("walletChip");
    if (chip) chip.innerHTML = '<span class="status-dot dim"></span> Wallet not connected';

    const ppBtn = document.getElementById("ppWalletBtn");
    if (ppBtn) { ppBtn.textContent = "Connect Wallet"; ppBtn.classList.remove("disconnect"); }

    document.dispatchEvent(new CustomEvent("wallet-disconnected"));
}

async function connectWallet() {
    const provider = getProvider();

    // No Phantom? Send them to install it.
    if (!provider) {
        window.open("https://phantom.com/download", "_blank");
        return;
    }

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
    // Phantom not installed -> only show the "I'm new" option
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const installed = !!getProvider();
    if (!installed) console.log("No wallet detected. window.phantom =", window.phantom, "window.ethereum =", window.ethereum);
    const name = walletName();
    document.querySelectorAll("[data-wallet-name]").forEach((el) => el.textContent = name);
    document.getElementById("connectHave").classList.toggle("hidden", !installed);
    document.getElementById("connectNoExt").classList.toggle("hidden", installed);
    profilePanel.classList.remove("open");
    connectModal.classList.remove("hidden");
}
function closeConnectModal() { if (connectModal) connectModal.classList.add("hidden"); }
function refreshWalletNames() {
    const name = walletName();
    document.querySelectorAll("[data-wallet-name]").forEach((el) => el.textContent = name);
    const nw = document.getElementById("connectNew");
    if (nw) nw.classList.toggle("hidden", !!getProvider() && name === "MetaMask");   // they already have a wallet
}
refreshWalletNames();
document.addEventListener("wallet-ready", refreshWalletNames);

if (connectModal) {
    document.getElementById("connectHave").addEventListener("click", () => {
        closeConnectModal();
        connectWallet();
    });
    document.getElementById("connectNew").addEventListener("click", closeConnectModal);
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
if (splash && !seenSplash) {
    try { sessionStorage.setItem("verity-splash", "1"); } catch (err) {}
    setTimeout(() => {
        splash.classList.add("out");                       // swoosh animation
        setTimeout(() => { splash.remove(); showWelcomeIfNeeded(); }, 750);
    }, 1400);
} else {
    if (splash) splash.remove();
    showWelcomeIfNeeded();
}

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
    openConnectModal();
});
document.getElementById("welcomeLater").addEventListener("click", closeWelcome);
} // end of Home-only welcome code

// If they connected before, show it straight away (no popup)
(async () => {
    const provider = getProvider();
    if (!provider) { walletReady = true; document.dispatchEvent(new Event("wallet-ready")); return; }

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

    // Switched account in Phantom? Update the card.
    if (provider.on) {
        provider.on("accountsChanged", (accounts) => {
            if (accounts.length && currentAccount) showConnected(accounts[0]);
            else if (!accounts.length) showDisconnected();
        });
    }
})();
