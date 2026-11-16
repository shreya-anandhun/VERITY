/* ==========================================================================
   poll.js - one poll's own page: /poll/7 (or poll.html?id=7)
   Question, options and voting, results (after you vote or once it ends),
   a votes-over-time chart, every vote from the blockchain, and share tools.
   Needs app.js, contract.js, extras.js and qrcode.js.
   ========================================================================== */
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const m = location.pathname.match(/\/poll\/(\d+)/);
    const pollId = Number(m ? m[1] : new URLSearchParams(location.search).get("id"));
    const permalink = pollLink(pollId, true);
    const fmt = (n) => Number(n).toLocaleString("en-IN");
    const short = (a) => shortAddress(a).replace(" •••• ", "…");
    const when = (ms) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    function ago(ms) {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return "just now";
        if (s < 3600) return Math.floor(s / 60) + " min ago";
        if (s < 86400) return Math.floor(s / 3600) + " h ago";
        return Math.floor(s / 86400) + " d ago";
    }

    let poll = null, myPick, events = [], sending = false, ticker = null;

    async function load(fresh) {
        try {
            const polls = await loadPolls(fresh);
            poll = polls.find((p) => p.id === pollId);
            if (!poll || Number.isNaN(pollId)) {
                $("pgLoading").classList.add("hidden");
                $("pgMissing").classList.remove("hidden");
                document.title = "Poll not found · VERITY";
                return;
            }
            myPick = undefined;
            if (currentAccount) {
                const mine = await loadMyVotes(currentAccount, [poll]);
                myPick = mine[pollId];
            }
            render();
            // the vote list and chart need an event search: fill them in when it arrives
            const evs = await queryEvents(readContract.filters.Voted(pollId));
            await Promise.all(evs.map(async (e) => { try { e.time = await blockTime(e.blockNumber); } catch (err) {} }));
            events = evs.sort((a, b) => a.blockNumber - b.blockNumber);
            renderHistory();
        } catch (err) {
            toast("Couldn't load this poll from Sepolia. " + (err.shortMessage || err.message || ""), "bad");
        }
    }

    const isLive = () => poll.isOpen && poll.endTime > Date.now();
    const reveal = () => myPick !== undefined || !isLive();

    function render() {
        $("pgLoading").classList.add("hidden");
        $("pgBody").classList.remove("hidden");
        document.title = poll.question + " · VERITY";
        // Link previews for shared poll links
        const setMeta = (sel, v) => { const m = document.querySelector(sel); if (m) m.setAttribute("content", v); };
        setMeta('meta[property="og:title"]', poll.question + " · VERITY"); setMeta('meta[name="twitter:title"]', poll.question + " · VERITY");
        setMeta('meta[property="og:url"]', location.origin + "/poll/" + poll.id);
        const d = `${poll.options.length} options · ${poll.totalVotes} vote${poll.totalVotes === 1 ? "" : "s"} · ${poll.category} poll on VERITY, recorded on Ethereum Sepolia.`;
        setMeta('meta[property="og:description"]', d); setMeta('meta[name="twitter:description"]', d);
        const live = isLive();
        $("pgStatus").className = live ? "live-pill" : "ended-pill";
        $("pgStatus").innerHTML = live ? '<span class="live-dot"></span> LIVE' : (poll.isOpen ? "ENDED" : "CLOSED BY CREATOR");
        $("pgCat").textContent = poll.category;
        $("pgNum").textContent = "Poll #" + poll.id;
        $("pgQuestion").textContent = poll.question;
        const by = currentAccount && poll.creator.toLowerCase() === currentAccount.toLowerCase() ? "you" : short(poll.creator);
        $("pgMeta").innerHTML = `Created by <span class="mono">${escapeHTML(by)}</span>${poll.createdAt ? " · " + when(poll.createdAt) : ""} · ` +
            (live ? `ends in <b id="pgLeft">${formatTimeLeft(poll.endTime - Date.now())}</b>` : `ended ${when(Math.min(poll.endTime, Date.now()))}`);
        clearInterval(ticker);
        if (live) ticker = setInterval(() => {
            const el = $("pgLeft");
            if (el) el.textContent = formatTimeLeft(poll.endTime - Date.now());
            if (poll.endTime <= Date.now()) { clearInterval(ticker); render(); }
        }, 1000);

        // Options: vote buttons, or the results
        const total = poll.votes.reduce((a, b) => a + b, 0);
        const top = Math.max(...poll.votes);
        let html;
        if (reveal()) {
            html = `<div class="pg-card-head"><h3>${live ? "Results so far" : "Final result"}</h3><span class="muted">${fmt(total)} ${total === 1 ? "vote" : "votes"}</span></div>` +
                poll.options.map((o, i) => {
                    const pct = total ? Math.round(poll.votes[i] / total * 100) : 0;
                    const lead = total && poll.votes[i] === top;
                    return `<div class="pg-res ${lead ? "lead" : ""} s${i % 10}">
                        <div class="pg-res-row"><span>${escapeHTML(o)}${myPick === i ? " <em>your vote</em>" : ""}${lead && !live ? ' <em class="win">winner</em>' : ""}</span><b>${fmt(poll.votes[i])} · ${pct}%</b></div>
                        <div class="pg-track"><i style="width:${pct}%"></i></div></div>`;
                }).join("");
        } else {
            html = `<div class="pg-card-head"><h3>Cast your vote</h3><span class="muted">${fmt(total)} ${total === 1 ? "vote" : "votes"} so far</span></div>
                <div class="pg-opts">${poll.options.map((o, i) => `<button class="pg-opt" data-pick="${i}" ${sending ? "disabled" : ""}><span>${escapeHTML(o)}</span><span class="pg-opt-go">Vote →</span></button>`).join("")}</div>
                <p class="pg-why muted">Results appear here after you vote, so nobody just follows the crowd. The counts are always public on the blockchain. <a href="how-it-works.html#why-results">Why?</a></p>`;
        }
        $("pgOptions").innerHTML = html;

        // Stat tiles
        const leader = total ? poll.options[poll.votes.indexOf(top)] : "No votes yet";
        $("pgStats").innerHTML = [
            [fmt(total), total === 1 ? "vote cast" : "votes cast"],
            ["…", "wallets voted"],
            [live ? formatTimeLeft(poll.endTime - Date.now()).replace(/ \d+s$/, "") : "Ended", live ? "left to vote" : (poll.isOpen ? "voting closed on time" : "closed early by its creator")],
            [reveal() ? escapeHTML(leader) : "Hidden", reveal() ? (live ? "leading now" : "won") : "the leader is shown after you vote"]
        ].map(([b, s], i) => `<div class="pg-stat ${i >= 2 ? "wide" : ""}"><b>${b}</b><span>${s}</span></div>`).join("");

        $("pgPresent").classList.toggle("hidden", !live);
        $("pgEtherscan").href = `https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#events`;
        $("pgReport").href = `contact.html?report=${poll.id}`;
        if (!$("pgQr").innerHTML && typeof qrcode === "function") {
            const q = qrcode(0, "M"); q.addData(permalink); q.make();
            $("pgQr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        }
        renderHistory();
    }

    /* ---------- the votes-over-time chart and the vote list ---------- */
    function renderHistory() {
        if (!poll) return;
        const show = reveal();
        $("pgVotesNote").textContent = events.length ? `${fmt(events.length)} found` : "";
        $("pgVotes").innerHTML = events.length ? events.slice().reverse().slice(0, 50).map((e) => `
            <li><span class="mono">${escapeHTML(short(e.args.voter))}</span>
                <span class="pg-v-opt">${show ? escapeHTML(poll.options[Number(e.args.optionIndex)] || "?") : '<span class="muted">choice shown after you vote</span>'}</span>
                <span class="muted">${e.time ? ago(e.time) : ""}</span>
                <a href="https://sepolia.etherscan.io/tx/${e.transactionHash}" target="_blank" rel="noopener">#${Number(e.blockNumber).toLocaleString("en-US")} ↗</a></li>`).join("")
            : '<li class="muted">No votes yet. Be the first.</li>';
        drawChart(show);
        const tiles = document.querySelectorAll(".pg-stat b");
        if (tiles[1]) tiles[1].textContent = fmt(new Set(events.map((e) => e.args.voter.toLowerCase())).size);
    }

    function drawChart(split) {
        const box = $("pgChart");
        const W = 720, H = 240, L = 40, R = 16, T = 14, B = 34;
        const pts = events.filter((e) => e.time);
        const start = poll.createdAt || (pts[0] ? pts[0].time - 3600000 : Date.now() - 86400000);
        const end = Math.max(start + 60000, Math.min(Date.now(), poll.endTime));
        $("pgChartNote").textContent = split ? "Each line is one option" : "Total turnout · the split by option appears after you vote";
        if (!pts.length) { box.innerHTML = '<p class="muted pg-empty">The chart starts with the first vote.</p>'; return; }
        const series = split ? poll.options.map((_, i) => i) : [-1];
        const max = Math.max(1, split ? Math.max(...poll.votes) : pts.length);
        const x = (t) => L + (Math.min(Math.max(t, start), end) - start) / (end - start) * (W - L - R);
        const y = (v) => T + (1 - v / max) * (H - T - B);
        let svg = "";
        const step = Math.max(1, Math.ceil(max / 4));
        for (let v = 0; v <= max; v += step) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
        for (let k = 0; k <= 3; k++) {
            const t = start + (end - start) * k / 3;
            svg += `<text class="axis" x="${x(t)}" y="${H - 10}" text-anchor="${k === 0 ? "start" : k === 3 ? "end" : "middle"}">${new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric" })}</text>`;
        }
        series.forEach((s) => {
            let c = 0, d = `M${x(start)},${y(0)}`;
            pts.forEach((e) => {
                if (s !== -1 && Number(e.args.optionIndex) !== s) return;
                d += ` H${x(e.time)} V${y(++c)}`;
            });
            d += ` H${x(end)}`;
            const cls = s === -1 ? "s0" : "s" + (s % 10);
            svg += `<path class="line ${cls}" d="${d}"/><circle class="dot ${cls}" cx="${x(end)}" cy="${y(c)}" r="4"><title>${s === -1 ? "Total" : escapeHTML(poll.options[s])}: ${c}</title></circle>`;
        });
        const legend = split ? `<div class="pg-legend">${poll.options.map((o, i) => `<span class="s${i % 10}"><i></i>${escapeHTML(o)}</span>`).join("")}</div>` : "";
        box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Votes over time">${svg}</svg>${legend}`;
    }

    /* ---------- voting ---------- */
    const confirmModal = $("confirmModal");
    let pick = null;
    document.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pick]");
        if (!b || sending) return;
        if (!currentAccount) { openConnectModal(); return; }
        pick = Number(b.dataset.pick);
        if (!getSetting("confirmVotes", true)) { castVote(); return; }
        $("confirmText").textContent = `You're voting for "${poll.options[pick]}"`;
        confirmModal.classList.remove("hidden");
        showFeeEstimate($("feeLine"), "vote", [pollId, pick]);
    });
    $("confirmNo").addEventListener("click", () => confirmModal.classList.add("hidden"));
    confirmModal.addEventListener("click", (e) => { if (e.target === confirmModal) confirmModal.classList.add("hidden"); });
    $("confirmYes").addEventListener("click", () => { confirmModal.classList.add("hidden"); castVote(); });

    async function castVote() {
        try {
            if (await readContract.hasVoted(pollId, currentAccount)) { toast("This wallet has already voted in this poll.", "bad"); return load(true); }
        } catch (err) {}
        sending = true; render();
        const journey = window.voteJourney;
        if (journey) journey.start({ poll: poll.question, option: poll.options[pick] });
        try {
            const r = await sendTx("vote", { poll: poll.question, option: poll.options[pick] },
                (c) => c.vote(pollId, pick), (hash) => { if (journey) journey.sent(hash); });
            if (r) { if (journey) journey.mined(r); else toast("Vote recorded on Sepolia ✓", "good"); }
            else if (journey) journey.close();
        } catch (err) { if (journey) journey.close(); toast(err.message, "bad"); }
        sending = false;
        await load(true);
    }

    /* ---------- share + tools ---------- */
    $("pgCopy").addEventListener("click", async () => {
        const ok = await copyText(permalink);
        $("pgCopy").textContent = ok ? "Link copied ✓" : "Couldn't copy";
        setTimeout(() => { $("pgCopy").textContent = "Copy link to this poll"; }, 1800);
    });
    $("pgRecount").setAttribute("data-recount", pollId);
    $("pgPresent").setAttribute("data-present", pollId);

    if (walletReady) load(); else document.addEventListener("wallet-ready", () => load(), { once: true });
    document.addEventListener("wallet-connected", () => load());
    setInterval(() => { if (!sending && poll && isLive() && !document.querySelector(".x-backdrop, .welcome-backdrop:not(.hidden)")) load(true); }, 20000);
})();

// Highlight the page you came from (Live Polls or Polls) in the sidebar
(function markOrigin() {
    const fromLive = /\/live(\.html)?(\?|#|$)/.test(document.referrer) || new URLSearchParams(location.search).get("from") === "live";
    if (!fromLive) return;
    document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", /live\.html$/.test(a.getAttribute("href"))));
})();
