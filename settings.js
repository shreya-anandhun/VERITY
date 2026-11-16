/* =========================================================
   VERITY — settings.js
   ========================================================= */

/* Theme */
const themePick = document.getElementById("themePick");
function markTheme() {
    const t = getSetting("theme", "dark");
    themePick.querySelectorAll(".theme-opt").forEach((b) => b.classList.toggle("on", b.dataset.theme === t));
}
themePick.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b) return;
    setSetting("theme", b.dataset.theme);
    applyTheme();
    markTheme();
});
markTheme();

/* Toggles: each switch is saved under its own key */
const switches = { notifEnds: true, notifFirst: true, confirmVotes: true };   // key -> default
Object.entries(switches).forEach(([id, def]) => {
    const el = document.getElementById(id);
    el.checked = getSetting(id, def);
    el.addEventListener("change", () => setSetting(id, el.checked));
});

/* Contract address + copy */
document.getElementById("contractAddr").textContent = CONTRACT_ADDRESS;
document.getElementById("contractLink").href = "https://sepolia.etherscan.io/address/" + CONTRACT_ADDRESS + "#code";
document.getElementById("copyAddr").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const ok = await copyText(CONTRACT_ADDRESS);
    btn.textContent = ok ? "Copied ✓" : "Couldn't copy";
    setTimeout(() => (btn.textContent = "Copy"), 1600);
});

/* Wallet row */
const setWalletBtn = document.getElementById("setWalletBtn");
function renderWallet() {
    document.getElementById("setWallet").textContent = currentAccount ? shortAddress(currentAccount) : "Not connected";
    setWalletBtn.textContent = currentAccount ? "Sign out" : "Connect";
    setWalletBtn.classList.toggle("danger", !!currentAccount);
}
setWalletBtn.addEventListener("click", () => currentAccount ? disconnectWallet() : openConnectModal());
document.addEventListener("wallet-connected", renderWallet);
document.addEventListener("wallet-disconnected", renderWallet);
renderWallet();

/* Clear everything VERITY keeps on this device (name, theme, toggles, local history notes) */
document.getElementById("clearData").addEventListener("click", () => {
    if (!confirm("Clear your display name, theme and settings on this device? Your on-chain votes are not affected.")) return;
    try {
        Object.keys(localStorage).filter((k) => k.startsWith("verity-")).forEach((k) => localStorage.removeItem(k));
        sessionStorage.clear();
    } catch (err) {}
    location.reload();
});


// Hidden polls (chosen from a poll's Report popup)
(function hiddenPollsSetting() {
    const count = document.getElementById("hiddenCount"), btn = document.getElementById("unhideAll");
    if (!count || !btn) return;
    const refresh = () => {
        const n = hiddenByUser().length;
        count.textContent = n ? `${n} poll${n === 1 ? "" : "s"} hidden on this device` : "You haven't hidden any polls";
        btn.disabled = !n;
    };
    btn.addEventListener("click", () => {
        localStorage.removeItem("verity-hidden");
        try { localStorage.removeItem("verity-polls-last"); sessionStorage.removeItem("verity-polls-cache"); } catch (e) {}
        refresh(); toast("Hidden polls will show again", "good");
    });
    refresh();
})();
