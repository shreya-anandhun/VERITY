/* =========================================================
   VERITY — activity.js  (Transactions page)
   ========================================================= */

/* ---------- DATA (comes from the contract) ----------
   One object = one transaction.                                    */
const MIN = 60000;
let transactions = [];     // this wallet's votes + polls, from the contract's events

const ETHERSCAN = "https://sepolia.etherscan.io/tx/";


/* ---------- Helpers ---------- */
// Network fee from a receipt, readable even when it's tiny (Sepolia gas is nearly free)
function feeText(r) {
    const wei = r.gasUsed * (r.gasPrice || 0n);
    const eth = Number(wei) / 1e18;
    if (!eth) return "—";
    if (eth < 0.000001) return "< 0.000001 ETH";
    return eth.toFixed(6) + " ETH";
}
const shortHash = (h) => h.slice(0, 10) + "…" + h.slice(-6);

function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " h ago";
    const d = Math.floor(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
}
function fullTime(ts) {
    return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function typeLabel(t) {
    if (t.type === "create") return "Created poll";
    return "Voted";
}
const typeIcon = {
    vote:   '<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="4"/></svg>',
    create: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};
const statusText = { pending: "Pending", confirmed: "Confirmed", failed: "Failed" };


/* ---------- Page elements ---------- */
const liveSection    = document.getElementById("liveSection");
const historySection = document.getElementById("historySection");
const trackList      = document.getElementById("trackList");
const txList         = document.getElementById("txList");
const emptyNoTx      = document.getElementById("emptyNoTx");
const emptyNotConn   = document.getElementById("emptyNotConnected");
const filterSel      = document.getElementById("filterSel");
const verifyForm     = document.getElementById("verifyForm");

let expandedHash = null;   // which history row is open


/* ---------- Load this wallet's history from the chain ---------- */
async function loadHistory() {
    if (!currentAccount) { transactions = []; return; }
    const me = currentAccount;
    const polls = await loadPolls();
    const list = [];
    let [votedEvs, createdEvs] = await Promise.all([
        queryEvents(readContract.filters.Voted(null, me)),
        queryEvents(readContract.filters.PollCreated(null, me))
    ]);
    // Polls hidden from the site are left out here too, so every page agrees on the counts
    votedEvs = votedEvs.filter((ev) => !HIDDEN_POLLS.includes(Number(ev.args.pollId)));
    createdEvs = createdEvs.filter((ev) => !HIDDEN_POLLS.includes(Number(ev.args.pollId)));
    for (const ev of votedEvs) {
        const p = polls.find((x) => x.id === Number(ev.args.pollId));
        list.push({ hash: ev.transactionHash, type: "vote", status: "confirmed", block: ev.blockNumber,
            poll: p ? p.question : `Poll #${ev.args.pollId}`, option: p ? p.options[Number(ev.args.optionIndex)] : "", time: 0 });
    }
    for (const ev of createdEvs) {
        list.push({ hash: ev.transactionHash, type: "create", status: "confirmed", block: ev.blockNumber,
            poll: ev.args.title, option: null, time: 0 });
    }
    // Times and fees are asked for together, not one after the other
    const timesReady = Promise.all(list.map(async (tx) => { tx.time = await blockTime(tx.block); }));
    await Promise.all(list.map(async (tx) => {
        // A confirmed transaction's fee never changes, so remember it in this browser
        const fees = getSetting("fees", {});
        if (fees[tx.hash]) { tx.feeWei = BigInt(fees[tx.hash]); tx.gas = feeText({ gasUsed: tx.feeWei, gasPrice: 1n }); return; }
        try {
            const r = await readProvider.getTransactionReceipt(tx.hash);
            if (r) {
                tx.gas = feeText(r); tx.feeWei = r.gasUsed * (r.gasPrice || 0n);
                const all = getSetting("fees", {}); all[tx.hash] = tx.feeWei.toString(); setSetting("fees", all);
            }
        } catch (err) {}
    }));
    await timesReady;

    // Pending ones noted in this browser: still pending, or mined since?
    for (const ptx of getSetting("pending", [])) {
        const r = await readProvider.getTransactionReceipt(ptx.hash).catch(() => null);
        if (!r) list.push({ ...ptx, status: "pending", block: null });
        else {
            forgetTx("pending", ptx.hash);
            if (r.status !== 1) rememberTx("failed", { ...ptx, reason: "The network rejected this transaction" });
        }
    }
    // Failed attempts noted in this browser
    for (const f of getSetting("failed", [])) {
        const reason = friendlyError({ message: f.reason || "" }) || f.reason;   // old entries may hold raw ethers text
        list.push({ ...f, reason, status: "failed", block: null, hash: f.hash || "" });
    }

    transactions = list;
    // Remember it, so the next visit can show the timeline instantly
    try { localStorage.setItem("verity-history", JSON.stringify({ who: me.toLowerCase(), list }, (k, v) => typeof v === "bigint" ? "n:" + v : v)); } catch (err) {}
}
function cachedHistory() {
    try {
        const c = JSON.parse(localStorage.getItem("verity-history"), (k, v) => typeof v === "string" && v.startsWith("n:") ? BigInt(v.slice(2)) : v);
        if (c && currentAccount && c.who === currentAccount.toLowerCase()) return c.list;
    } catch (err) {}
    return null;
}


/* ---------- Render everything ---------- */
async function renderAll() {
    document.querySelector(".content").classList.remove("waiting");
    if (currentAccount) { emptyNotConn.classList.add("hidden"); historySection.classList.remove("hidden"); verifyForm.classList.remove("hidden"); emptyNoTx.classList.remove("hidden"); emptyNoTx.textContent = "Loading your activity from Sepolia…"; }
    // Show what we saw last time straight away, then check the chain for anything new
    const old = cachedHistory();
    if (old && !transactions.length) { transactions = old; paint(); }
    try { await loadHistory(); }
    catch (err) { console.log("History load failed", err); toast("Something went wrong loading from Sepolia: " + (err.shortMessage || err.message).slice(0, 80), "bad"); }
    document.querySelector(".content").classList.remove("waiting");
    paint();
}
function paint() {
    const connected = !!currentAccount;
    emptyNotConn.classList.toggle("hidden", connected);
    historySection.classList.toggle("hidden", !connected);
    verifyForm.classList.remove("hidden");                 // verifying a hash needs no wallet
    if (!connected) { liveSection.classList.add("hidden"); return; }
    renderTracker();
    renderHistory();
}

/* 2. In-progress tracker: 3 steps per pending transaction */
function renderTracker() {
    const pending = transactions.filter((t) => t.status === "pending");
    liveSection.classList.toggle("hidden", !pending.length);
    trackList.innerHTML = pending.map((t) => {
        // Which step are we on? Signed happens instantly; "sent" after ~2s
        const age = Date.now() - t.time;
        const step = age < 2000 ? 1 : 2;
        const steps = ["Signed in Phantom", "Sent to network", "Confirmed"];
        return `
        <article class="track-card" data-hash="${t.hash}">
            <div class="track-top">
                <div class="track-title">
                    <span class="tx-icon">${typeIcon[t.type]}</span>
                    <div>
                        <strong>${typeLabel(t)}${t.option ? ` · ${escapeHTML(t.option)}` : ""}</strong>
                        <small>${escapeHTML(t.poll)}</small>
                    </div>
                </div>
                <span class="status-pill pending"><span class="live-dot"></span> Pending</span>
            </div>
            <ol class="steps">
                ${steps.map((label, i) => {
                    const n = i + 1;
                    const cls = n < step ? "done" : n === step ? "active" : "";
                    return `<li class="step ${cls}"><span class="step-dot"></span><span class="step-label">${label}</span></li>`;
                }).join("")}
            </ol>
            <div class="track-foot">
                <span class="mono">${t.hash ? shortHash(t.hash) : ""}</span>
                <span class="track-timer" data-start="${t.time}">0s</span>
            </div>
        </article>`;
    }).join("");
}

/* 3. Timeline, grouped by day */
function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, now)) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
function clockTime(ts) { return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); }

function renderHistory() {
    const f = filterSel.value;
    let list = transactions.filter((t) => t.status !== "pending");
    if (f === "failed") list = list.filter((t) => t.status === "failed");
    else if (f !== "all") list = list.filter((t) => t.type === f);
    list.sort((a, b) => b.time - a.time);

    // Summary tiles (always from the full list, not the filter)
    const all = transactions.filter((t) => t.status !== "pending");
    setText("statConfirmed", all.filter((t) => t.status === "confirmed").length);
    setText("statFailed", all.filter((t) => t.status === "failed").length);
    setText("statCreatedTx", all.filter((t) => t.type === "create" && t.status === "confirmed").length);
    const feeWei = all.reduce((n, t) => n + (t.feeWei || 0n), 0n);
    setText("statFees", feeWei ? feeText({ gasUsed: feeWei, gasPrice: 1n }) : "0 ETH");

    emptyNoTx.classList.toggle("hidden", list.length > 0);
    emptyNoTx.textContent = all.length ? "Nothing matches this filter" : "No transactions yet";

    let lastDay = null;
    txList.innerHTML = list.map((t) => {
        const key = t.hash || "f" + t.time;
        const day = dayLabel(t.time);
        const head = day !== lastDay ? `<div class="tl-day">${day}</div>` : "";
        lastDay = day;
        const kind = t.status === "failed" ? "failed" : t.type === "create" ? "create" : "vote";
        const icon = kind === "failed" ? "!" : kind === "create" ? "+" : "✓";
        return `
        ${head}
        <div class="tl-when"><b>${clockTime(t.time)}</b>${timeAgo(t.time)}</div>
        <div class="tl-node"><i class="${kind}"></i></div>
        <article class="tl-card ${kind}" data-hash="${key}">
            <span class="tl-ic">${icon}</span>
            <span class="tl-text">
                <strong>${typeLabel(t)}${t.option ? ` · ${escapeHTML(t.option)}` : ""}</strong>
                <small>${escapeHTML(t.poll)}${t.block ? ` · block #${t.block.toLocaleString("en-US")}` : ""}${t.reason ? ` · ${escapeHTML(t.reason)}` : ""}</small>
            </span>
            <span class="tl-right">
                <span class="status-pill ${t.status}">${statusText[t.status]}</span>
                ${t.hash ? `<button class="small-btn" data-receipt="${key}">Receipt</button>` : ""}
            </span>
        </article>`;
    }).join("");
}

// Receipt popup
const receiptModal = document.getElementById("receiptModal");
txList.addEventListener("click", (e) => {
    const b = e.target.closest("[data-receipt]");
    if (!b) return;
    const t = transactions.find((x) => (x.hash || "f" + x.time) === b.dataset.receipt);
    if (!t) return;
    document.getElementById("receiptTitle").textContent = typeLabel(t) + (t.option ? ` · ${t.option}` : "");
    document.getElementById("receiptBody").innerHTML = detailsHTML(t) +
        (t.type === "vote" && t.status === "confirmed" && window.showVoteCard
            ? '<button type="button" class="small-btn" id="getVoteCard" style="margin-top:14px">Get my "I voted" card</button>' : "");
    const cardBtn = document.getElementById("getVoteCard");
    if (cardBtn) cardBtn.onclick = () => {
        receiptModal.classList.add("hidden");
        window.showVoteCard({ poll: t.poll, hash: t.hash, block: t.block, time: t.time, voter: currentAccount });
    };
    receiptModal.classList.remove("hidden");
});
document.getElementById("receiptClose").addEventListener("click", () => receiptModal.classList.add("hidden"));
receiptModal.addEventListener("click", (e) => { if (e.target === receiptModal) receiptModal.classList.add("hidden"); });

// Export CSV
document.getElementById("exportCsv").addEventListener("click", () => {
    const rows = [["type", "status", "poll", "option", "time", "block", "fee", "hash", "reason"]];
    for (const t of transactions) rows.push([typeLabel(t), t.status, t.poll, t.option || "", new Date(t.time).toISOString(), t.block || "", t.gas || "", t.hash || "", t.reason || ""]);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "verity-activity.csv";
    a.click();
    URL.revokeObjectURL(a.href);
});
filterSel.addEventListener("change", renderHistory);

// Full-detail grid, shared by history rows and the verify result
function detailsHTML(t) {
    return `
    <dl class="detail-grid">
        <div><dt>Poll</dt><dd>${escapeHTML(t.poll)}</dd></div>
        ${t.option ? `<div><dt>Your choice</dt><dd>${escapeHTML(t.option)}</dd></div>` : ""}
        <div><dt>Status</dt><dd><span class="status-pill ${t.status}">${statusText[t.status]}</span></dd></div>
        <div><dt>Time</dt><dd>${fullTime(t.time)}</dd></div>
        <div><dt>Wallet</dt><dd class="mono">${t.wallet ? shortAddress(t.wallet) : currentAccount ? shortAddress(currentAccount) : "—"}</dd></div>
        <div><dt>Block</dt><dd>${t.block ? "#" + t.block.toLocaleString("en-US") : "—"}</dd></div>
        <div><dt>Network fee</dt><dd>${t.gas || "—"}</dd></div>
        <div class="wide"><dt>Transaction hash</dt><dd class="mono">${t.hash || "Never reached the network (rejected before sending)"}</dd></div>
        ${t.reason ? `<div class="wide"><dt>Why it failed</dt><dd class="fail-reason">${escapeHTML(t.reason)}</dd></div>` : ""}
    </dl>
    ${t.hash ? `<a class="etherscan-link" href="${ETHERSCAN}${t.hash}" target="_blank" rel="noopener">View on Etherscan ↗</a>` : ""}`;
}



/* ---------- 1. Verify a transaction ---------- */
const verifyResult = document.getElementById("verifyResult");

verifyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hash = document.getElementById("verifyInput").value.trim();
    verifyResult.classList.remove("hidden");

    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        verifyResult.innerHTML = `<p class="verify-msg bad">That doesn't look like a transaction hash. It should start with 0x and be 66 characters long.</p>`;
        return;
    }
    verifyResult.innerHTML = `<p class="verify-msg">Looking it up on Sepolia…</p>`;
    try {
        const receipt = await readProvider.getTransactionReceipt(hash);
        if (!receipt) { verifyResult.innerHTML = `<p class="verify-msg bad">No transaction with this hash on Sepolia yet. It may still be pending, or it's on another network.</p>`; return; }
        if (receipt.to && receipt.to.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
            verifyResult.innerHTML = `<p class="verify-msg bad">This transaction isn't from VERITY (it was sent to a different contract).</p>`; return;
        }
        const block = await readProvider.getBlock(receipt.blockNumber);
        const txInfo = await readProvider.getTransaction(hash);
        const polls = await loadPolls();
        let t = { hash, status: receipt.status === 1 ? "confirmed" : "failed", block: receipt.blockNumber, time: block.timestamp * 1000,
                  gas: feeText(receipt), type: "vote", poll: "—", option: null, wallet: txInfo.from };
        for (const log of receipt.logs) {
            let parsed = null;
            try { parsed = readContract.interface.parseLog(log); } catch (err) {}
            if (!parsed) continue;
            if (parsed.name === "Voted") { const p = polls.find((x) => x.id === Number(parsed.args.pollId)); t.type = "vote"; t.poll = p ? p.question : `Poll #${parsed.args.pollId}`; t.option = p ? p.options[Number(parsed.args.optionIndex)] : ""; }
            if (parsed.name === "PollCreated") { t.type = "create"; t.poll = parsed.args.title; }
            if (parsed.name === "PollClosed") { const p = polls.find((x) => x.id === Number(parsed.args.pollId)); t.type = "create"; t.poll = (p ? p.question : `Poll #${parsed.args.pollId}`) + " (closed)"; }
        }
        if (t.status === "failed") t.reason = "The network rejected this transaction";
        verifyResult.innerHTML = `
            <div class="verify-card">
                <p class="welcome-kicker">${t.status === "confirmed" ? "Verified on Ethereum Sepolia" : "Found on Sepolia · failed"}</p>
                <h3>${typeLabel(t)}${t.option ? ` · ${escapeHTML(t.option)}` : ""}</h3>
                ${detailsHTML(t)}
            </div>`;
    } catch (err) {
        verifyResult.innerHTML = `<p class="verify-msg bad">Couldn't look that up right now. ${escapeHTML(friendlyError(err) || "")}</p>`;
    }
});


/* ---------- Timers: pending counters + "x min ago" ---------- */
setInterval(() => {
    document.querySelectorAll(".track-timer").forEach((el) => {
        el.textContent = Math.floor((Date.now() - Number(el.dataset.start)) / 1000) + "s";
    });
}, 1000);



// Re-check the chain while something is pending
setInterval(() => { if (currentAccount && transactions.some((x) => x.status === "pending")) renderAll(); }, 6000);


/* ---------- Wallet state ---------- */
document.getElementById("activityConnect").addEventListener("click", openConnectModal);
document.addEventListener("wallet-connected", renderAll);
document.addEventListener("wallet-disconnected", renderAll);
// Don't paint until we know if a wallet is already connected (avoids a double pop-in)
if (walletReady) renderAll(); else document.addEventListener("wallet-ready", renderAll, { once: true });
