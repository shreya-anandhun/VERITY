/* =========================================================
   VERITY — polls.js  (Create Poll / all polls page)
   ========================================================= */

const CATEGORIES = ["Club", "College", "Tech", "Events", "Fun", "Other"];
const H = 3600000, D = 24 * H;

/* ---------- DATA (comes from the contract) ----------
   creator = wallet address that called createPoll.                 */
let allPolls = [];      // every poll, loaded from the contract


// Placeholder: polls this wallet voted in -> option index (later: Voted events)
let myVotes = {};

/* ---------- Helpers ---------- */
const sum = (a) => a.reduce((x, y) => x + y, 0);
const isLive = (p) => p.isOpen && p.endTime > Date.now();
const isMine = (p) => currentAccount && p.creator.toLowerCase() === currentAccount.toLowerCase();

function whenText(p) {
    if (isLive(p)) return "Ends in " + formatTimeLeft(p.endTime - Date.now()).replace(/ \d\ds$/, "");
    if (!p.isOpen && p.endTime > Date.now()) return "Closed by creator";
    return "Ended " + new Date(p.endTime).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function creatorText(p) {
    return isMine(p) ? "You" : shortAddress(p.creator);
}


/* ---------- Controls ---------- */
const rows      = document.getElementById("pollRows");
const emptyEl   = document.getElementById("emptyPolls");
const searchIn  = document.getElementById("searchInput");
const statusSel = document.getElementById("statusSel");
const sortSel   = document.getElementById("sortSel");
const chipsEl   = document.getElementById("catChips");
let category = "All";
let openId = null;   // which ended poll is expanded

chipsEl.innerHTML = ["All", ...CATEGORIES].map((c) =>
    `<button class="chip ${c === "All" ? "on" : ""}" data-cat="${c}">${c}</button>`).join("");
chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    category = b.dataset.cat;
    chipsEl.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    render();
});
[searchIn, statusSel, sortSel].forEach((el) => el.addEventListener("input", render));


/* ---------- Result breakdown for an ended poll ---------- */
function resultHTML(p) {
    const total = sum(p.votes);
    const top = Math.max(...p.votes);
    const winners = p.options.filter((_, i) => p.votes[i] === top);
    const mine = (typeof myVotes !== "undefined" && myVotes[p.id] !== undefined) ? myVotes[p.id] : -1;
    const pct = (v) => total ? Math.round((v / total) * 100) : 0;

    // Options sorted by votes, highest first
    const order = p.options.map((_, i) => i).sort((a, b) => p.votes[b] - p.votes[a]);
    const bars = order.map((i) => `
        <div class="result-bar ${p.votes[i] === top && total ? "winner" : ""} ${mine === i ? "mine" : ""}">
            <span class="result-fill" style="width:${pct(p.votes[i])}%"></span>
            <span class="result-row-text">
                <span>${escapeHTML(p.options[i])}${mine === i ? '<span class="your-choice">Your choice</span>' : ""}</span>
                <span class="result-nums"><b>${pct(p.votes[i])}%</b> · ${p.votes[i].toLocaleString("en-IN")}</span>
            </span>
        </div>`).join("");

    const headline = !total ? "No votes were cast"
        : winners.length > 1 ? `Tie · ${winners.map(escapeHTML).join(" & ")}`
        : `Winner · ${escapeHTML(winners[0])}`;

    return `
    <div class="result-head">
        <p class="welcome-kicker">${headline}</p>
        <span class="result-meta">${total.toLocaleString("en-IN")} votes · ended ${new Date(p.endTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
    </div>
    <div class="result-bars">${bars}</div>
    <a class="etherscan-link" href="https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}" target="_blank" rel="noopener">Verified on-chain ↗</a>`;
}

/* ---------- Render the list ---------- */
function render() {
    const q = searchIn.value.trim().toLowerCase();
    let list = allPolls.filter((p) => {
        if (category !== "All" && p.category !== category) return false;
        const st = statusSel.value;
        if (st === "live"  && !isLive(p)) return false;
        if (st === "ended" &&  isLive(p)) return false;
        if (st === "mine"  && !isMine(p)) return false;
        if (q && !p.question.toLowerCase().includes(q) && !p.options.some((o) => o.toLowerCase().includes(q))) return false;
        return true;
    });

    const s = sortSel.value;
    if (s === "newest") list.sort((a, b) => b.createdAt - a.createdAt);
    if (s === "votes")  list.sort((a, b) => sum(b.votes) - sum(a.votes));
    if (s === "ending") list.sort((a, b) => (isLive(b) - isLive(a)) || (a.endTime - b.endTime));

    const live = allPolls.filter(isLive).length;
    document.getElementById("pollsSummary").textContent =
        `${allPolls.length} poll${allPolls.length === 1 ? "" : "s"} · ${live} live · ${allPolls.length - live} ended`;

    emptyEl.classList.toggle("hidden", list.length > 0);
    emptyEl.innerHTML = allPolls.length
        ? 'No polls match. <button class="link-btn" id="clearFilters">Clear filters</button>'
        : "No polls yet. Be the first to create one.";
    const clr = document.getElementById("clearFilters");
    if (clr) clr.onclick = () => {
        searchIn.value = ""; statusSel.value = "all"; sortSel.value = "newest"; category = "All";
        chipsEl.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.cat === "All"));
        render();
    };
    rows.innerHTML = list.map((p) => {
        if (p.pending) {
            return `
            <article class="poll-row live pending-row">
                <div class="row-main">
                    <span class="status-pill pending"><span class="live-dot"></span> Confirming</span>
                    <span class="row-text"><strong>${escapeHTML(p.question)}</strong><small><span class="cat-chip">${p.category}</span> · by You · ${p.options.length} options · waiting for the block</small></span>
                    <span class="row-right"><span class="row-votes">0 <em>votes</em></span><span class="row-when">${whenText(p)}</span></span>
                </div>
            </article>`;
        }
        const live = isLive(p);
        const inner = `
            <span class="status-pill ${live ? "confirmed" : "ended"}">${live ? '<span class="live-dot"></span> Live' : "Ended"}</span>
            <span class="row-text">
                <strong>${escapeHTML(p.question)}</strong>
                <small><span class="cat-chip">${p.category}</span> · by ${creatorText(p)} · ${p.options.length} options</small>
            </span>
            <span class="row-right">
                <span class="row-votes">${sum(p.votes).toLocaleString("en-IN")} <em>${sum(p.votes) === 1 ? "vote" : "votes"}</em></span>
                <span class="row-when">${whenText(p)}</span>
            </span>`;

        // Live poll -> link to Live Polls (creator gets a Close button beside the link)
        if (live) {
            return `
            <article class="poll-row live ${isMine(p) ? "has-close" : ""}">
                <a class="row-main" href="live.html?poll=${p.id}" aria-label="Open poll: ${escapeHTML(p.question)}">
                    ${inner}
                    <svg class="row-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </a>
                ${isMine(p) ? `<button class="close-poll" data-close="${p.id}" title="Close this poll">Close poll</button>` : ""}
            </article>`;
        }

        // Ended poll -> expands in place to show the result
        const open = p.id === openId;
        return `
        <article class="poll-row ended result-row ${open ? "open" : ""}" data-id="${p.id}">
            <button class="row-main" data-expand="${p.id}" aria-expanded="${open}" aria-label="Show results for: ${escapeHTML(p.question)}">
                ${inner}
                <svg class="tx-chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="tx-details"><div>${open ? resultHTML(p) : ""}</div></div>
        </article>`;
    }).join("");
}
async function loadAll(first = false) {
    try {
        allPolls = await loadPolls();
        myVotes = await loadMyVotes(currentAccount, allPolls);
    } catch (err) {
        console.log("Polls load failed", err);
        toast("Something went wrong loading from Sepolia: " + (err.shortMessage || err.message).slice(0, 80), "bad");
    }
    document.querySelector(".content").classList.remove("waiting");
    if (first) rows.classList.add("fresh");          // rows slide in once
    render();
    if (first) setTimeout(() => rows.classList.remove("fresh"), 600);
}
if (walletReady) loadAll(true); else document.addEventListener("wallet-ready", () => loadAll(true), { once: true });
setInterval(render, 60000);   // keep "Ends in" fresh

// Expand / collapse an ended poll
rows.addEventListener("click", (e) => {
    const b = e.target.closest("[data-expand]");
    if (!b) return;
    openId = openId === Number(b.dataset.expand) ? null : Number(b.dataset.expand);
    render();
});

// Arrived from a link? e.g. polls.html?poll=5 opens that result
const wantedPoll = new URLSearchParams(location.search).get("poll");
if (wantedPoll !== null) {
    const p = allPolls.find((x) => x.id === Number(wantedPoll));
    if (p && !isLive(p)) { openId = p.id; setTimeout(() => rows.querySelector(".open")?.scrollIntoView({ behavior: "smooth", block: "start" }), 700); }
    else if (p) location.replace(`live.html?poll=${p.id}`);
}


/* ---------- Confirm popup (shared by create + close) ---------- */
const confirmModal = document.getElementById("confirmModal");
let onConfirm = null;

function ask(kicker, text, yesText, fn) {
    document.getElementById("confirmKicker").textContent = kicker;
    document.getElementById("confirmText").textContent = text;
    document.getElementById("confirmYesText").textContent = yesText;
    onConfirm = fn;
    confirmModal.classList.remove("hidden");
}
document.getElementById("confirmNo").addEventListener("click", () => { confirmModal.classList.add("hidden"); onConfirm = null; });
document.getElementById("confirmYes").addEventListener("click", async () => {
    confirmModal.classList.add("hidden");
    if (!currentAccount) { toast("Connect your wallet first.", ""); openConnectModal(); onConfirm = null; return; }
    if (onConfirm) onConfirm();
    onConfirm = null;
});


/* ---------- Close a poll you created ---------- */
rows.addEventListener("click", (e) => {
    const b = e.target.closest("[data-close]");
    if (!b) return;
    const p = allPolls.find((x) => x.id === Number(b.dataset.close));
    document.getElementById("confirmNote").textContent = "Closing ends voting immediately. This cannot be undone. Your wallet will ask you to sign.";
    ask("Close poll", `Close "${p.question}" now?`, "Yes, close it permanently", async () => {
        try {
            const r = await sendTx("close", { poll: p.question, option: null }, (c) => c.closePoll(p.id));
            if (r) toast("Poll closed ✓", "good");
        } catch (err) { toast(err.message, "bad"); }
        await loadAll();
    });
});


/* ---------- Create a poll ---------- */
const createModal = document.getElementById("createModal");
const createForm  = document.getElementById("createForm");
const cfOptions   = document.getElementById("cfOptions");
const cfCategory  = document.getElementById("cfCategory");
const cfEnd       = document.getElementById("cfEnd");
cfCategory.insertAdjacentHTML("beforeend", CATEGORIES.map((c) => `<option>${c}</option>`).join(""));

function optionRow(i) {
    return `<div class="cf-opt">
        <input class="field" placeholder="Option ${i + 1}" maxlength="40" required>
        <button type="button" class="cf-remove" aria-label="Remove option" title="Remove this option" ${i < 2 ? 'style="visibility:hidden" tabindex="-1"' : ""}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
    </div>`;
}
function resetCreateForm() {
    createForm.reset();
    document.getElementById("cfError").classList.add("hidden");
    cfOptions.innerHTML = optionRow(0) + optionRow(1);
    updateOptionCount();
    // Earliest allowed end: 1 hour from now, in the input's local format
    const min = new Date(Date.now() + H);
    min.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    cfEnd.min = `${min.getFullYear()}-${pad(min.getMonth() + 1)}-${pad(min.getDate())}T${pad(min.getHours())}:${pad(min.getMinutes())}`;
}
document.getElementById("createBtn").addEventListener("click", async () => {
    if (!currentAccount) { openConnectModal(); return; }
    resetCreateForm();
    createModal.classList.remove("hidden");
    document.getElementById("cfQuestion").focus();
});
document.getElementById("createCancel").addEventListener("click", () => createModal.classList.add("hidden"));
function updateOptionCount() {
    const n = cfOptions.children.length;
    const btn = document.getElementById("cfAddOption");
    btn.textContent = n >= 10 ? "Max 10" : "+ Add option";
    btn.disabled = n >= 10;
    document.getElementById("cfOptCount").textContent = `Options · ${n} of 10`;
}
document.getElementById("cfAddOption").addEventListener("click", () => {
    const n = cfOptions.children.length;
    if (n >= 10) return;
    cfOptions.insertAdjacentHTML("beforeend", optionRow(n));
    cfOptions.lastElementChild.querySelector("input").focus();
    updateOptionCount();
});
cfOptions.addEventListener("click", (e) => {
    const b = e.target.closest(".cf-remove");
    if (!b || b.disabled) return;
    b.parentElement.remove();
    updateOptionCount();
    [...cfOptions.querySelectorAll("input")].forEach((inp, i) => inp.placeholder = `Option ${i + 1}`);
});

createForm.addEventListener("input", () => document.getElementById("cfError").classList.add("hidden"));
createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const question = document.getElementById("cfQuestion").value.trim();
    const options  = [...cfOptions.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
    const endTime  = new Date(cfEnd.value).getTime();

    const err = document.getElementById("cfError");
    err.classList.add("hidden");
    if (options.length < 2) { err.textContent = "Add at least two options."; err.classList.remove("hidden"); return; }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
        err.textContent = "Two options are the same. Make each one different."; err.classList.remove("hidden"); return;
    }
    if (!(endTime > Date.now() + H - 60000)) { err.textContent = "The poll must run for at least an hour."; err.classList.remove("hidden"); return; }
    createModal.classList.add("hidden");

    document.getElementById("confirmNote").textContent = "This is recorded on the blockchain and costs a small network fee. Your wallet will ask you to sign.";
    ask("Create poll", `Create "${question}" with ${options.length} options?`, "Yes, create it", async () => {
        const category = cfCategory.value;
        try {
            const r = await sendTx("create", { poll: question, option: null },
                (c) => c.createPoll(question, category, options, Math.floor(endTime / 1000)),
                () => {
                    // Show it straight away while Sepolia confirms it
                    allPolls.unshift({ id: "pending", question, category, options, votes: options.map(() => 0),
                        creator: currentAccount, createdAt: Date.now(), endTime, isOpen: true, totalVotes: 0, pending: true });
                    statusSel.value = "all"; sortSel.value = "newest";
                    render();
                    toast("Poll sent to Sepolia. Confirming… (about 15 seconds)", "");
                });
            if (r) { toast("Poll created on Sepolia ✓", "good"); statusSel.value = "mine"; sortSel.value = "newest"; }
        } catch (err) { toast(err.message, "bad"); }
        await loadAll();
    });
});

// Close popups from the backdrop
[createModal, confirmModal].forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); }));

// "Mine" and "You" depend on the wallet
document.addEventListener("wallet-connected", () => loadAll());
document.addEventListener("wallet-disconnected", () => { if (statusSel.value === "mine") statusSel.value = "all"; loadAll(); });
