/* ==========================================================================
   home.js - the Home page's live sections
   1. "Live now": the busiest open poll, with a ticking countdown, plus two more
   2. Community numbers: how many different wallets have voted
   3. Recent activity: the latest votes and polls, read straight from Sepolia
   Needs app.js + contract.js.
   ========================================================================== */
(function () {
    "use strict";
    const featured = document.getElementById("liveFeature");
    if (!featured) return;
    const side = document.getElementById("sidePolls");
    const feed = document.getElementById("activityFeed");
    const ETHERSCAN = "https://sepolia.etherscan.io/tx/";

    function ago(ms) {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return "just now";
        if (s < 3600) return Math.floor(s / 60) + " min ago";
        if (s < 86400) return Math.floor(s / 3600) + " h ago";
        const d = Math.floor(s / 86400);
        return d + (d === 1 ? " day ago" : " days ago");
    }
    const short = (a) => shortAddress(a).replace(" •••• ", "…");

    /* ---------- 1. Live now ---------- */
    let ticking = null;
    function drawLive(polls) {
        const live = polls.filter((p) => p.isOpen && p.endTime > Date.now())
            .sort((a, b) => b.totalVotes - a.totalVotes || a.endTime - b.endTime);
        clearInterval(ticking);
        if (!live.length) {
            featured.innerHTML = '<p class="h-empty">No polls are open right now. <a href="polls.html">Create the next one →</a></p>';
            side.innerHTML = "";
            return;
        }
        const p = live[0];
        featured.innerHTML = `
            <div class="h-f-top">
                <span class="live-pill"><span class="live-dot"></span> LIVE</span>
                <span class="h-f-meta">${escapeHTML(p.category)} · Poll #${p.id}</span>
                <span class="h-f-time">ends in <b id="featTime">${formatTimeLeft(p.endTime - Date.now())}</b></span>
            </div>
            <h4>${escapeHTML(p.question)}</h4>
            <div class="h-f-opts">${p.options.map((o, i) =>
                `<a class="h-opt" href="${pollLink(p.id)}"><span>${escapeHTML(o)}</span><span class="h-opt-go" aria-hidden="true">Vote →</span></a>`).join("")}
            </div>
            <p class="h-f-foot"><span>${p.totalVotes} ${p.totalVotes === 1 ? "vote" : "votes"} so far · results appear after you vote</span>
                <a href="${pollLink(p.id)}">Open poll page →</a></p>`;
        ticking = setInterval(() => {
            const el = document.getElementById("featTime");
            if (el) el.textContent = formatTimeLeft(p.endTime - Date.now());
        }, 1000);
        side.innerHTML = live.slice(1, 3).map((q) => `
            <a class="h-mini" href="${pollLink(q.id)}">
                <span class="h-mini-cat">${escapeHTML(q.category)}</span>
                <b>${escapeHTML(q.question)}</b>
                <span class="h-mini-meta">${q.totalVotes} ${q.totalVotes === 1 ? "vote" : "votes"} · ends in ${formatTimeLeft(q.endTime - Date.now()).replace(/ \d+s$/, "")}</span>
            </a>`).join("") +
            (live.length > 3 ? `<a class="h-mini more" href="live.html">+ ${live.length - 3} more live ${live.length - 3 === 1 ? "poll" : "polls"} →</a>` : "");
    }

    /* ---------- 2 + 3. Wallet count and the activity feed ---------- */
    const FEED_CACHE = "verity-feed";
    function drawFeed(items, wallets) {
        if (wallets !== undefined) {
            const w = document.getElementById("totalWallets");
            if (w) { w.textContent = wallets; w.classList.remove("num-wait"); }
        }
        if (!items.length) { feed.innerHTML = '<li class="h-empty">No activity yet. Be the first to vote.</li>'; return; }
        feed.innerHTML = items.map((x) => `
            <li>
                <span class="h-ev ${x.kind}" aria-hidden="true">${x.kind === "vote" ? "✓" : "+"}</span>
                <span class="h-ev-text"><span class="mono">${escapeHTML(x.who)}</span> ${x.kind === "vote" ? "voted in" : "created"} <a class="h-ev-poll" href="${pollLink(x.id)}">${escapeHTML(x.poll)}</a></span>
                <span class="h-ev-when">${x.time ? ago(x.time) : ""}</span>
                <a class="h-ev-link" href="${ETHERSCAN}${x.hash}" target="_blank" rel="noopener" aria-label="View this transaction on Etherscan">Block #${Number(x.block).toLocaleString("en-US")} ↗</a>
            </li>`).join("");
    }
    async function loadFeed(polls) {
        const title = (id) => (polls.find((p) => p.id === id) || {}).question;
        const [votes, made] = await Promise.all([
            queryEvents(readContract.filters.Voted()),
            queryEvents(readContract.filters.PollCreated())
        ]);
        const keep = (ev) => !HIDDEN_POLLS.includes(Number(ev.args.pollId)) && title(Number(ev.args.pollId));
        const wallets = new Set(votes.filter(keep).map((ev) => ev.args.voter.toLowerCase())).size;
        const items = [
            ...votes.filter(keep).map((ev) => ({ kind: "vote", id: Number(ev.args.pollId), who: short(ev.args.voter), poll: title(Number(ev.args.pollId)), block: ev.blockNumber, hash: ev.transactionHash })),
            ...made.filter(keep).map((ev) => ({ kind: "create", id: Number(ev.args.pollId), who: short(ev.args.creator), poll: title(Number(ev.args.pollId)), block: ev.blockNumber, hash: ev.transactionHash }))
        ].sort((a, b) => b.block - a.block).slice(0, 6);
        await Promise.all(items.map(async (x) => { try { x.time = await blockTime(x.block); } catch (err) {} }));
        drawFeed(items, wallets);
        try { localStorage.setItem(FEED_CACHE, JSON.stringify({ items, wallets })); } catch (err) {}
    }

    async function run() {
        // last visit's feed straight away, then the fresh one
        try {
            const c = JSON.parse(localStorage.getItem(FEED_CACHE));
            if (c && c.items) drawFeed(c.items, c.wallets);
        } catch (err) {}
        let polls;
        try { polls = await loadPolls(); } catch (err) {
            featured.innerHTML = '<p class="h-empty">Couldn\'t reach Sepolia just now. <a href="">Try again</a></p>';
            return;
        }
        drawLive(polls);
        try { await loadFeed(polls); }
        catch (err) { if (!feed.querySelector(".h-ev")) feed.innerHTML = '<li class="h-empty">Couldn\'t load recent activity. It will appear on your next visit.</li>'; }
    }
    run();
    document.addEventListener("polls-fresh", () => loadPolls().then((p) => { drawLive(p); loadFeed(p).catch(() => {}); }).catch(() => {}));
})();
