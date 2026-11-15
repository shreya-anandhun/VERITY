/* =========================================================
   VERITY — live.js  (Live Polls page)
   ========================================================= */

/* ---------- DATA (comes from the contract) ----------
   votes = how many people picked each option, in order.          */
const HOUR = 3600000;
let livePolls = [];      // live polls, loaded from the contract

// Which polls this wallet already voted in, and what they picked.
// Later: read from the contract's hasVoted + the Voted event.
// Format: { pollId: optionIndex }
let myVotes = {};
let myVoteTxs = {};   // pollId -> transaction hash of my vote


/* ---------- Helpers ---------- */
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function pollTotal(p) { return sum(p.votes); }

// "Popularity": rank by total voters, plus a label from votes-per-hour
function popularity(p, ranked) {
    const rank = ranked.findIndex((x) => x.id === p.id) + 1;
    const hoursLive = Math.max(1, (Date.now() - p.createdAt) / HOUR);
    const perHour = pollTotal(p) / hoursLive;
    let label = "Quiet";
    if (perHour >= 25) label = "Trending";
    else if (perHour >= 8) label = "Rising";
    return { rank, label, total: ranked.length };
}

function pct(part, total) { return total ? Math.round((part / total) * 100) : 0; }


/* ---------- Build the grid ---------- */
const grid = document.getElementById("pollGrid");
let ranked = [];
let sortMode = "votes";
function rankPolls() {
    const r = [...livePolls];
    if (sortMode === "ending") r.sort((a, b) => a.endTime - b.endTime);
    else if (sortMode === "newest") r.sort((a, b) => b.id - a.id);   // ids are given in creation order on-chain, so this is always right
    else r.sort((a, b) => pollTotal(b) - pollTotal(a));
    return r;
}
document.getElementById("sortTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]");
    if (!b) return;
    sortMode = b.dataset.sort;
    document.querySelectorAll("#sortTabs .tab").forEach((t) => t.classList.toggle("on", t === b));
    ranked = rankPolls();
    render();
});
// Search box: filter the live polls by question, option or category
let searchText = "";
document.getElementById("liveSearch").addEventListener("input", (e) => {
    searchText = e.target.value.trim().toLowerCase();
    render();
});
function matchesSearch(p) {
    if (!searchText) return true;
    return (p.question + " " + p.options.join(" ") + " " + (p.category || "")).toLowerCase().includes(searchText);
}
let openId = null;   // which poll is expanded right now
let sending = null;  // pollId while a vote is being confirmed by the network

async function loadLive() {
    try {
        const all = await loadPolls();
        livePolls = all.filter((p) => p.isOpen && p.endTime > Date.now());
        myVotes = await loadMyVotes(currentAccount, livePolls);
        // Receipt links need an event search, which is slow: fill them in afterwards
        loadMyVoteTxs(currentAccount).then((m) => {
            const changed = JSON.stringify(m) !== JSON.stringify(myVoteTxs);
            myVoteTxs = m;
            if (changed && sending === null && !document.querySelector(".welcome-backdrop:not(.hidden), .x-backdrop")) render();
        });
    } catch (err) {
        console.log("Live polls load failed", err);
        toast("Something went wrong loading from Sepolia: " + (err.shortMessage || err.message).slice(0, 80), "bad");
    }
    ranked = rankPolls();
    setText("pageSub", `${livePolls.length} live · updates every 15 s`);
    if (openId !== null && !livePolls.some((p) => p.id === openId)) openId = null;   // not live (any more)
    document.body.classList.toggle("poll-open", openId !== null);
    document.querySelector(".content").classList.remove("waiting");
    render();
    // Arrived with ?poll=N (a shared link or QR code)? Bring that poll into view, once
    if (openId !== null && !scrolledToWanted) {
        const card = grid.querySelector(".expanded");
        if (card) { scrolledToWanted = true; setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 300); }
    }
}
let scrolledToWanted = false;

function render() {
    const shown = ranked.filter((p) => matchesSearch(p) || p.id === openId);
    const empty = document.getElementById("emptyLive");
    empty.classList.toggle("hidden", shown.length > 0);
    if (!shown.length) {
        empty.textContent = ranked.length ? "No live polls match your search" : "No polls currently live";
        grid.innerHTML = ""; buildRail(); return;
    }
    const tools = (id) => `<span class="card-tools"><a class="tool-btn" href="${pollLink(id)}" title="This poll's own page: chart, every vote, share link">Details</a><button class="tool-btn" data-recount="${id}" title="Count the votes yourself, straight from the blockchain">Recount</button><button class="tool-btn" data-present="${id}" title="Full-screen view with a QR code, for a projector">Present</button></span>`;

    grid.innerHTML = shown.map((p) => {
        const total = pollTotal(p);
        const isOpen = p.id === openId;
        const voted = myVotes[p.id];               // undefined if not voted
        const pop = popularity(p, ranked);

        // Collapsed card
        if (!isOpen) {
            const showBars = voted !== undefined;
            const meta = `${p.category || "Other"} · by ${currentAccount && p.creator && p.creator.toLowerCase() === currentAccount.toLowerCase() ? "You" : shortAddress(p.creator || "0x0000000000000000000000000000000000000000")} · ${p.options.length} options · <b>${total.toLocaleString("en-IN")} ${total === 1 ? "vote" : "votes"}</b>`;
            if (voted !== undefined) {
                // Already voted: show the result right here
                const bars = p.options.map((opt, i) => `
                    <div class="mini-row"><span>${escapeHTML(opt)}${voted === i ? ' <b class="mine-tag">· your choice</b>' : ""}</span><span>${pct(p.votes[i], total)}%</span></div>
                    <div class="mini-bar"><i style="width:${pct(p.votes[i], total)}%" class="${voted === i ? "mine" : ""}"></i></div>`).join("");
                return `
                <article class="poll-card live-card voted-card" data-id="${p.id}">
                    <div class="poll-top">
                        <span class="live-pill voted"><span class="live-dot"></span> You voted</span>
                        <span class="time-left">ends in <b data-end="${p.endTime}">${formatTimeLeft(p.endTime - Date.now())}</b></span>
                    </div>
                    <h3 class="poll-question">${escapeHTML(p.question)}</h3>
                    <p class="card-meta">${meta}</p>
                    <div class="mini-bars">${bars}</div>
                    <div class="card-actions">
                        <a class="small-btn" href="${myVoteTxs[p.id] ? "https://sepolia.etherscan.io/tx/" + myVoteTxs[p.id] : "https://sepolia.etherscan.io/address/" + CONTRACT_ADDRESS}" target="_blank" rel="noopener">Receipt ↗</a>
                        <button class="small-btn" data-share="${p.id}">Share</button>
                        <button class="small-btn" data-report="${p.id}">Report</button>
                        ${tools(p.id)}
                    </div>
                </article>`;
            }
            return `
            <article class="poll-card live-card" data-id="${p.id}">
                <div class="poll-top">
                    <span class="live-pill"><span class="live-dot"></span> LIVE</span>
                    <span class="time-left">ends in <b data-end="${p.endTime}">${formatTimeLeft(p.endTime - Date.now())}</b></span>
                </div>
                <h3 class="poll-question">${escapeHTML(p.question)}</h3>
                <p class="card-meta">${meta}</p>
                <div class="poll-bottom">
                    <button class="vote-btn" data-open="${p.id}" aria-label="Vote on: ${escapeHTML(p.question)}">
                        Vote
                        <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                    </button>
                    <span class="muted why-line">${showBars ? "Results are shown" : 'Results shown after you vote · <a href="how-it-works.html#why-results">why?</a>'}</span>
                </div>
                <div class="card-actions tools-only">${tools(p.id)}</div>
            </article>`;
        }

        // Expanded card
        const optionsHTML = p.options.map((opt, i) => {
            const percent = pct(p.votes[i], total);
            const mine = voted === i;
            const showBars = voted !== undefined;
            return `
            <button class="option ${showBars ? "has-result" : ""} ${voted !== undefined ? "locked" : ""} ${mine ? "mine" : ""}"
                    data-vote="${i}" aria-label="${voted !== undefined ? "Result: " : "Vote for "}${escapeHTML(opt)}" ${voted !== undefined ? 'aria-disabled="true"' : ""}>
                <span class="option-fill" style="width:${showBars ? percent : 0}%"></span>
                <span class="option-row">
                    <span class="option-text">${escapeHTML(opt)}${mine ? '<span class="your-choice">Your choice</span>' : ""}</span>
                    <span class="option-pct">${showBars ? percent + "%" : ""}</span>
                </span>
            </button>`;
        }).join("");

        return `
        <article class="poll-card live-card expanded" data-id="${p.id}">
            <button class="close-btn" data-close aria-label="Close">
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>

            <div class="poll-top expanded-top">
                <span class="live-pill"><span class="live-dot"></span> LIVE</span>
                <span class="time-left">Time left <b data-end="${p.endTime}">${formatTimeLeft(p.endTime - Date.now())}</b></span>
            </div>

            <h3 class="poll-question big">${escapeHTML(p.question)}</h3>

            <div class="options">${optionsHTML}</div>

            ${sending === p.id ? `<p class="hint-line sending"><span class="live-dot"></span> Vote sent. Waiting for Sepolia to confirm…</p>` : ""}
            ${voted !== undefined ? `
            <p class="verified-line">
                Your vote is recorded on Ethereum Sepolia ·
                <a href="${myVoteTxs[p.id] ? "https://sepolia.etherscan.io/tx/" + myVoteTxs[p.id] : "https://sepolia.etherscan.io/address/" + CONTRACT_ADDRESS}" target="_blank" rel="noopener">${myVoteTxs[p.id] ? "View your vote on Etherscan ↗" : "View the contract on Etherscan ↗"}</a>
            </p>` : `<p class="hint-line">Pick an option to cast your vote. You can only vote once.<br><small>Results are revealed after you vote, so nobody is swayed by the crowd. Totals are public on Etherscan at any time.</small></p>`}

            <div class="meta-row">
                <div class="meta">
                    <small>Voted</small>
                    <span>${total.toLocaleString("en-IN")}</span>
                </div>
                <div class="meta">
                    <small>Popularity</small>
                    <span>#${pop.rank} of ${pop.total} <em class="pop-label ${pop.label.toLowerCase()}">${pop.label}</em></span>
                </div>
                <div class="meta">
                    <small>Time left</small>
                    <span data-end="${p.endTime}">${formatTimeLeft(p.endTime - Date.now())}</span>
                </div>
            </div>

            <button class="report-poll" data-report="${p.id}">
                <svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>
                Report this poll
            </button>
        </article>`;
    }).join("");
    buildRail();
}

/* ---------- Scroll rail: shows how far down the page you are ---------- */
// One diamond per row of polls. The lit diamond follows the scroll position (top = first,
// bottom = last), and clicking a diamond jumps to that row.
const rail = document.createElement("nav");
rail.className = "scroll-rail hidden";
rail.setAttribute("aria-label", "Jump to a row of polls");
document.body.appendChild(rail);
let railRows = [];
function buildRail() {
    // group the cards into rows by their top edge (the grid has 2 columns on wide screens)
    const cards = [...grid.querySelectorAll(".live-card")];
    railRows = [];
    cards.forEach((c) => {
        const top = Math.round(c.offsetTop);
        const row = railRows.find((r) => Math.abs(r.top - top) < 40);
        if (row) row.cards.push(c); else railRows.push({ top, cards: [c] });
    });
    railRows.sort((a, b) => a.top - b.top);
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 40;
    rail.classList.toggle("hidden", railRows.length < 2 || !scrollable);
    rail.innerHTML = railRows.map((r, i) => `<button data-jump="${i}" aria-label="Go to row ${i + 1} of ${railRows.length}"><i></i></button>`).join("") +
        '<span class="rail-hint" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>scroll</span>';
    markRail();
}
function markRail() {
    if (!railRows.length) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    const active = Math.round(progress * (railRows.length - 1));
    rail.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === active));
    rail.classList.toggle("at-end", progress > 0.97);
}
rail.addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    if (!b) return;
    const i = Number(b.dataset.jump);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    // same scale as the indicator: first diamond = top, last = bottom, the rest evenly in between
    window.scrollTo({ top: Math.round(max * i / Math.max(1, railRows.length - 1)), behavior: "smooth" });
});
let railTick = false;
window.addEventListener("scroll", () => {
    if (railTick) return;
    railTick = true;
    requestAnimationFrame(() => { railTick = false; markRail(); });
}, { passive: true });
window.addEventListener("resize", buildRail);
// cards change height as they slide in and as results load: re-measure once things settle
setTimeout(buildRail, 900);

if (walletReady) loadLive(); else document.addEventListener("wallet-ready", loadLive, { once: true });
document.addEventListener("wallet-connected", loadLive);
// Quiet refresh from the chain every 15 s (not while a vote is confirming)
setInterval(() => { if (sending === null && !document.querySelector(".welcome-backdrop:not(.hidden), .x-backdrop")) loadPolls(true).then(loadLive).catch(() => {}); }, 15000);
document.addEventListener("polls-fresh", () => { if (sending === null) loadLive(); });
document.addEventListener("wallet-disconnected", loadLive);


/* ---------- Clicks inside the grid ---------- */
grid.addEventListener("click", (e) => {
    const openBtn  = e.target.closest("[data-open]");
    const closeBtn = e.target.closest("[data-close]");
    const voteBtn  = e.target.closest("[data-vote]");
    const repBtn   = e.target.closest("[data-report]");

    if (openBtn)  { openPoll(Number(openBtn.dataset.open)); return; }
    if (closeBtn) { closePoll(); return; }
    if (repBtn)   { openReport(Number(repBtn.dataset.report)); return; }
    const shareBtn = e.target.closest("[data-share]");
    if (shareBtn) {
        const url = pollLink(Number(shareBtn.dataset.share), true);
        copyText(url).then((ok) => toast(ok ? "Link copied" : url, ok ? "good" : ""));
        return;
    }
    if (voteBtn) {
        if (voteBtn.classList.contains("locked")) { toast("You've already voted in this poll. Votes can't be changed.", ""); return; }
        if (sending !== null) { toast("Hold on, your vote is still being confirmed.", ""); return; }
        askConfirm(openId, Number(voteBtn.dataset.vote));
    }
});

function openPoll(id) {
    openId = id;
    render();
    document.body.classList.add("poll-open");          // used for the phone full-screen sheet
    const card = grid.querySelector(".expanded");
    if (card && window.innerWidth > 860) card.scrollIntoView({ behavior: "smooth", block: "start" });
}
function closePoll() {
    openId = null;
    document.body.classList.remove("poll-open");
    render();
}

// Came here from the Home card? e.g. live.html?poll=0
const wanted = new URLSearchParams(location.search).get("poll");
if (wanted !== null) openId = Number(wanted);   // opened once the polls arrive (if it's live)


// Escape closes the expanded poll (after any popup on top of it)
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openId !== null && !e.closedPopup) closePoll();
});


/* ---------- Countdowns (all of them, every second) ---------- */
setInterval(() => {
    document.querySelectorAll("[data-end]").forEach((el) => {
        el.textContent = formatTimeLeft(Number(el.dataset.end) - Date.now());
    });
}, 1000);


/* ---------- Confirm vote popup ---------- */
const confirmModal = document.getElementById("confirmModal");
let pending = null;   // { pollId, optionIndex }

function askConfirm(pollId, optionIndex) {
    const poll = livePolls.find((p) => p.id === pollId);
    pending = { pollId, optionIndex };
    // Settings -> "Ask me to confirm before every vote" turned off? Vote straight away.
    if (!getSetting("confirmVotes", true)) { document.getElementById("confirmYes").click(); return; }
    document.getElementById("confirmText").textContent =
        `You're voting for "${poll.options[optionIndex]}"`;
    confirmModal.classList.remove("hidden");
    showFeeEstimate(document.getElementById("feeLine"), "vote", [pollId, optionIndex]);
}
document.getElementById("confirmNo").addEventListener("click", () => {
    confirmModal.classList.add("hidden");
    pending = null;
});
document.getElementById("confirmYes").addEventListener("click", async () => {
    confirmModal.classList.add("hidden");
    if (!pending) return;

    // Must be connected to vote: go through the proper connect popup
    if (!currentAccount) {
        pending = null;
        toast("Connect your wallet first, then pick your option again.", "");
        openConnectModal();
        return;
    }

    const { pollId, optionIndex } = pending;
    pending = null;
    const poll = livePolls.find((p) => p.id === pollId);
    // Ask the chain first: has this wallet already voted here?
    try {
        if (await readContract.hasVoted(pollId, currentAccount)) {
            toast("This wallet has already voted in this poll.", "bad");
            await loadLive();
            return;
        }
    } catch (err) {}
    sending = pollId;
    render();
    const journey = window.voteJourney;                // the animated tracker (extras.js)
    if (journey) journey.start({ poll: poll.question, option: poll.options[optionIndex] });
    try {
        const receipt = await sendTx("vote", { poll: poll.question, option: poll.options[optionIndex] },
            (c) => c.vote(pollId, optionIndex),
            (hash) => { if (journey) journey.sent(hash); else toast("Vote sent to Sepolia. Confirming… (about 15 seconds)", ""); });
        if (receipt) { if (journey) journey.mined(receipt); else toast("Vote recorded on Sepolia ✓", "good"); }
        else if (journey) journey.close();             // cancelled in the wallet
    } catch (err) {
        if (journey) journey.close();
        toast(err.message, "bad");
    }
    sending = null;
    try { await loadPolls(true); } catch (err) {}      // fetch the fresh tallies first, so the card updates at once
    await loadLive();
});


/* ---------- Report poll popup ---------- */
const reportModal = document.getElementById("reportModal");
let reportingId = null;

function openReport(id) {
    reportingId = id;
    document.getElementById("reportForm").reset();
    document.getElementById("reportForm").classList.remove("hidden");
    document.getElementById("reportDone").classList.add("hidden");
    reportModal.classList.remove("hidden");
}
document.getElementById("reportCancel").addEventListener("click", () => reportModal.classList.add("hidden"));
document.getElementById("reportForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const reason  = document.getElementById("reportReason").value;
    const details = document.getElementById("reportDetails").value.trim();
    const poll    = livePolls.find((p) => p.id === reportingId);

    const subject = `VERITY - Poll report #${reportingId}`;
    const bodyText = `Poll ID: ${reportingId}\nQuestion: ${poll.question}\nReason: ${reason}\n\nDetails:\n${details || "-"}`;

    // Try the email app, but also show the report so it can be copied if nothing opens
    window.location.href = `mailto:verity.helpdesk@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    document.getElementById("reportForm").classList.add("hidden");
    const done = document.getElementById("reportDone");
    done.classList.remove("hidden");
    done.querySelector("pre").textContent = `To: verity.helpdesk@gmail.com\nSubject: ${subject}\n\n${bodyText}`;
    done.querySelector("[data-copy]").onclick = async (ev) => {
        const ok = await copyText(`To: verity.helpdesk@gmail.com\nSubject: ${subject}\n\n${bodyText}`);
        ev.currentTarget.querySelector("span").textContent = ok ? "Copied ✓" : "Couldn't copy";
    };
});
document.getElementById("reportClose").addEventListener("click", () => reportModal.classList.add("hidden"));

// Close any popup by clicking the dark backdrop
[confirmModal, reportModal].forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
});
