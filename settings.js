/* =========================================================
   VERITY — settings.js
   ========================================================= */

/* Theme */
const themePick = document.getElementById("themePick");
function markTheme() {
    const t = getSetting("theme", "light");
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
document.getElementById("contractLink").href = "https://sepolia.etherscan.io/address/" + CONTRACT_ADDRESS;
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
