/* ==========================================================================
   extras.js - three features that let people check VERITY for themselves
   1. Presenter mode  : full-screen live results + a QR code to vote
   2. Recount         : re-add every vote from the blockchain, in the browser
   3. Vote journey    : watch your vote travel into a block, then get a card
   Needs app.js + contract.js (and qrcode.js for the QR codes).
   ========================================================================== */
(function () {
    "use strict";

    const SITE = location.protocol.startsWith("http") ? location.origin : "https://shreya-verity.vercel.app";
    const SPARK = '<svg viewBox="-1 -1 2 2" aria-hidden="true"><path d="M0,-1 C0.08,-0.08 0.08,-0.08 1,0 C0.08,0.08 0.08,0.08 0,1 C-0.08,0.08 -0.08,0.08 -1,0 C-0.08,-0.08 -0.08,-0.08 0,-1Z"/></svg>';
    const esc = (t) => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };
    const num = (n) => Number(n).toLocaleString("en-US");
    const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
    const pct = (v, total) => total ? Math.round((v / total) * 100) : 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /* ---------- QR code (drawn as an SVG, or onto a canvas) ---------- */
    function qrMatrix(text) {
        if (typeof qrcode !== "function") return null;
        const q = qrcode(0, "M");
        q.addData(text);
        q.make();
        const n = q.getModuleCount();
        const rows = [];
        for (let y = 0; y < n; y++) { rows.push([]); for (let x = 0; x < n; x++) rows[y].push(q.isDark(y, x)); }
        return rows;
    }
    function qrSVG(text, color) {
        const m = qrMatrix(text);
        if (!m) return "";
        let rects = "";
        m.forEach((row, y) => row.forEach((on, x) => { if (on) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`; }));
        return `<svg viewBox="0 0 ${m.length} ${m.length}" style="fill:${color};stroke:none" shape-rendering="crispEdges" role="img" aria-label="QR code">${rects}</svg>`;
    }

    /* ---------- One popup shell for all three ---------- */
    let closeCurrent = null;
    function openModal(html, { wide = false, onClose } = {}) {
        if (closeCurrent) closeCurrent();
        const back = document.createElement("div");
        back.className = "x-backdrop";
        back.innerHTML = `<div class="x-modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
        document.body.appendChild(back);
        const close = () => {
            back.remove();
            document.removeEventListener("keydown", onKey, true);
            if (closeCurrent === close) closeCurrent = null;
            if (onClose) onClose();
        };
        const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.closedPopup = true; close(); } };
        document.addEventListener("keydown", onKey, true);
        back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-x-close]")) close(); });
        closeCurrent = close;
        return { el: back.firstElementChild, close };
    }

    async function getPoll(id, fresh) {
        const polls = await loadPolls(fresh);
        return polls.find((p) => p.id === id);
    }


    /* ======================================================================
       1. PRESENTER MODE
       ====================================================================== */
    let presentTimer = null;
    async function present(id) {
        let poll;
        try { poll = await getPoll(id, false); } catch (err) {}
        if (!poll) { toast("Couldn't open that poll", "bad"); return; }
        const url = `${SITE}/live?poll=${id}`;

        const root = document.createElement("div");
        root.className = "x-present x-backdrop";
        root.innerHTML = `
            <div class="xp-top">
                <div class="xp-brand">${SPARK}VERITY</div>
                <div class="xp-top-right">
                    <span class="live-pill" id="xpStatus"><span class="live-dot"></span> LIVE</span>
                    <button class="small-btn" id="xpExit">Exit presenter mode ✕</button>
                </div>
            </div>
            <div class="xp-main">
                <p class="xp-kicker">${esc(poll.category || "Other")} · Poll #${id}</p>
                <h1 class="xp-q">${esc(poll.question)}</h1>
                <div class="xp-bars" id="xpBars">${poll.options.map((o, i) => `
                    <div class="xp-bar" data-i="${i}">
                        <div class="xp-row"><span>${esc(o)}</span><b>0 · 0%</b></div>
                        <div class="xp-track"><i style="width:0%"></i></div>
                    </div>`).join("")}</div>
                <div class="xp-tick">
                    <span><b id="xpTotal">0</b> votes on-chain</span>
                    <span><b class="mono" id="xpBlock">…</b> latest block</span>
                    <span class="muted">checks the chain every 5 s</span>
                </div>
                <div class="xp-new" id="xpNew">${SPARK}<span></span></div>
            </div>
            <aside class="xp-qr">
                <div class="xp-qr-img">${qrSVG(url, "#111518")}</div>
                <h2>Scan to vote</h2>
                <p>One wallet, one vote. Watch your vote land on the big screen.</p>
                <p class="xp-url mono">${esc(url.replace(/^https?:\/\//, ""))}</p>
                <p class="xp-help">On a phone, tap Phantom or MetaMask in the bar at the bottom to open this page in your wallet app. The wallet must be on Sepolia.</p>
            </aside>`;
        document.body.appendChild(root);
        document.body.classList.add("x-noscroll");
        if (root.requestFullscreen) root.requestFullscreen().catch(() => {});

        let lastTotal = -1, lastBlock = 0, alive = true, pillTimer = null;
        function paint(p) {
            const total = p.votes.reduce((a, b) => a + b, 0);
            const top = Math.max(...p.votes);
            root.querySelectorAll(".xp-bar").forEach((bar) => {
                const i = Number(bar.dataset.i);
                bar.classList.toggle("lead", total > 0 && p.votes[i] === top);
                bar.querySelector("b").textContent = `${num(p.votes[i])} · ${pct(p.votes[i], total)}%`;
                bar.querySelector("i").style.width = pct(p.votes[i], total) + "%";
            });
            root.querySelector("#xpTotal").textContent = num(total);
            const live = p.isOpen && p.endTime > Date.now();
            const st = root.querySelector("#xpStatus");
            st.innerHTML = live ? `<span class="live-dot"></span> LIVE · ends in ${formatTimeLeft(p.endTime - Date.now()).replace(/ \d+s$/, "")}` : "CLOSED · final result";
            st.classList.toggle("ended", !live);
            return total;
        }
        async function tick() {
            if (!alive) return;
            try {
                const [p, block] = await Promise.all([getPoll(id, true), readProvider.getBlockNumber()]);
                if (!alive || !p) return;
                const total = paint(p);
                root.querySelector("#xpBlock").textContent = "#" + num(block);
                if (lastTotal >= 0 && total > lastTotal) {
                    // who just voted? look only at the blocks since we last checked
                    let text = "New vote just landed";
                    try {
                        const evs = await readContract.queryFilter(readContract.filters.Voted(id), Math.max(lastBlock - 2, 0), "latest");
                        const ev = evs[evs.length - 1];
                        if (ev) text = `New vote from ${short(ev.args.voter)} · block #${num(ev.blockNumber)}`;
                    } catch (err) {}
                    const pill = root.querySelector("#xpNew");
                    pill.querySelector("span").textContent = text;
                    pill.classList.remove("show"); void pill.offsetWidth; pill.classList.add("show");
                    clearTimeout(pillTimer);
                    pillTimer = setTimeout(() => pill.classList.remove("show"), 9000);
                }
                lastTotal = total; lastBlock = block;
            } catch (err) { console.log("Presenter refresh failed", err); }
        }
        paint(poll);
        requestAnimationFrame(() => paint(poll));
        tick();
        presentTimer = setInterval(tick, 5000);

        function exit() {
            alive = false;
            clearInterval(presentTimer);
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("fullscreenchange", onFs);
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            root.remove();
            document.body.classList.remove("x-noscroll");
        }
        const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.closedPopup = true; exit(); } };
        let wasFull = false;
        const onFs = () => { if (document.fullscreenElement) wasFull = true; else if (wasFull) exit(); };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("fullscreenchange", onFs);
        root.querySelector("#xpExit").addEventListener("click", exit);
    }


    /* ======================================================================
       2. RECOUNT IT YOURSELF
       ====================================================================== */
    async function recount(id) {
        const modal = openModal(`
            <p class="x-kicker">${SPARK} Independent recount</p>
            <h2>Don't trust us. Count the votes yourself.</h2>
            <p class="x-sub">Your browser is reading every vote straight from the Sepolia blockchain and adding them up. VERITY has no server in between.</p>
            <div class="xr-prog"><i id="xrProg"></i></div>
            <div class="xr-cols">
                <div>
                    <p class="x-label" id="xrFound">Looking for vote events…</p>
                    <div class="xr-feed" id="xrFeed"></div>
                </div>
                <div>
                    <table class="xr-table"><thead><tr><th>Option</th><th class="n">Your recount</th><th class="n">Contract says</th><th></th></tr></thead><tbody id="xrRows"></tbody></table>
                    <div class="xr-stamp hidden" id="xrStamp"></div>
                </div>
            </div>
            <div class="x-foot">
                <span id="xrSource">Reading from a public Sepolia node</span>
                <span class="x-btns">
                    <a class="small-btn" href="https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#events" target="_blank" rel="noopener">Open contract on Etherscan ↗</a>
                    <button class="small-btn" data-x-close>Close</button>
                </span>
            </div>`, { wide: true });
        const $ = (sel) => modal.el.querySelector(sel);
        let stillOpen = true;
        const watch = new MutationObserver(() => { if (!document.body.contains(modal.el)) { stillOpen = false; watch.disconnect(); } });
        watch.observe(document.body, { childList: true });

        try {
            // 1. every Voted event for this poll, and what the contract itself reports
            // If the node hangs, give up after 25 seconds and show the retry button instead
            const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("it took more than 25 seconds")), 25000));
            const [events, poll, latest] = await Promise.race([Promise.all([
                queryEvents(readContract.filters.Voted(id)),
                getPoll(id, true),
                readProvider.getBlockNumber()
            ]), timeout]);
            if (!stillOpen) return;
            if (!poll) throw new Error("Poll not found");
            const tally = poll.options.map(() => 0);
            $("#xrRows").innerHTML = poll.options.map((o, i) => `
                <tr data-i="${i}"><td>${esc(o)}</td><td class="n mine">0</td><td class="n">${num(poll.votes[i])}</td><td class="ok"></td></tr>`).join("");
            $("#xrSource").textContent = `Read from blocks ${num(DEPLOY_BLOCK)} to ${num(latest)} via a public Sepolia node`;

            // 2. add them up one at a time, so you can watch
            const feed = $("#xrFeed");
            const wait = Math.max(35, Math.min(220, 2600 / Math.max(events.length, 1)));
            const voters = new Set();
            let done = 0;
            if (!events.length) feed.innerHTML = '<p class="muted" style="padding:14px 0">No votes have been cast in this poll yet.</p>';
            for (const ev of events) {
                if (!stillOpen) return;
                const opt = Number(ev.args.optionIndex);
                tally[opt]++; done++;
                voters.add(ev.args.voter.toLowerCase());
                const row = document.createElement("div");
                row.className = "new";
                row.innerHTML = `<span class="mono">${short(ev.args.voter)}</span><span class="mono dim">blk ${num(ev.blockNumber)}</span><span class="opt">${esc(poll.options[opt] || "?")}</span>`;
                feed.prepend(row);
                setTimeout(() => row.classList.remove("new"), 500);
                while (feed.children.length > 40) feed.lastChild.remove();
                $(`#xrRows tr[data-i="${opt}"] .mine`).textContent = num(tally[opt]);
                $("#xrFound").textContent = `Vote events found · ${done} of ${events.length}`;
                $("#xrProg").style.width = (done / events.length * 100) + "%";
                await sleep(wait);
            }
            $("#xrProg").style.width = "100%";
            if (!events.length) $("#xrFound").textContent = "Vote events found · 0";

            // 3. the verdict
            let allMatch = true;
            poll.options.forEach((_, i) => {
                const ok = tally[i] === poll.votes[i];
                if (!ok) allMatch = false;
                const cell = $(`#xrRows tr[data-i="${i}"] .ok`);
                cell.textContent = ok ? "✓" : "✗";
                cell.classList.toggle("bad", !ok);
            });
            const dupes = events.length - voters.size;
            const stamp = $("#xrStamp");
            stamp.classList.remove("hidden");
            stamp.classList.toggle("bad", !allMatch || dupes > 0);
            stamp.innerHTML = allMatch && !dupes
                ? `<span class="ck">✓</span><span><b>Recount matches the contract</b><small>${num(events.length)} ${events.length === 1 ? "vote" : "votes"} · ${num(voters.size)} different ${voters.size === 1 ? "wallet" : "wallets"} · 0 duplicates</small></span>`
                : `<span class="ck">!</span><span><b>The numbers don't match</b><small>Recount found ${num(events.length)} votes from ${num(voters.size)} wallets. Try again in a few seconds: a vote may have landed mid-count.</small></span>`;
        } catch (err) {
            if (!stillOpen) return;
            $("#xrFound").textContent = "Couldn't finish the recount";
            $("#xrProg").style.width = "100%";
            $("#xrProg").style.background = "#E25656";
            $("#xrFeed").innerHTML = `<div class="xr-fail">
                <p>The public Sepolia node didn't answer: ${esc((err.shortMessage || err.message || "network error").slice(0, 110))}.<br>This is the node's fault, not the votes' — they're safe on-chain.</p>
                <button class="small-btn fill" id="xrRetry">Retry the recount</button></div>`;
            const retry = $("#xrRetry");
            if (retry) retry.onclick = () => { modal.close(); recount(id); };
        }
    }


    /* ======================================================================
       3. VOTE JOURNEY + "I VOTED" CARD
       ====================================================================== */
    function cardHTML(v) {
        const link = "https://sepolia.etherscan.io/tx/" + v.hash;
        const when = v.time ? new Date(v.time).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
        return `
        <div class="xc-card">
            <div class="xc-head">
                <span class="xc-big">${SPARK}</span>
                <div class="xc-brand">${SPARK}VERITY</div>
                <h3>I voted.</h3>
                <p>Verified on the Ethereum blockchain</p>
            </div>
            <div class="xc-body">
                <dl>
                    <div><dt>Poll</dt><dd>${esc(v.poll)}</dd></div>
                    <div><dt>Voter</dt><dd class="mono">${esc(typeof shortAddress === "function" && v.voter ? shortAddress(v.voter) : short(v.voter))}</dd></div>
                    <div><dt>Block · Time</dt><dd>#${num(v.block)}${when ? " · " + when : ""}</dd></div>
                    <div><dt>Transaction</dt><dd class="mono small">${short(v.hash)}</dd></div>
                </dl>
                <div class="xc-qr">${qrSVG(link, "#5B2FB8")}<small>Scan to verify on Etherscan</small></div>
            </div>
            <div class="xc-foot">
                <button class="small-btn fill" data-card-dl>Download card</button>
                <button class="small-btn" data-card-copy>Copy link</button>
            </div>
        </div>`;
    }
    function wireCard(scope, v) {
        const link = "https://sepolia.etherscan.io/tx/" + v.hash;
        const dl = scope.querySelector("[data-card-dl]"), cp = scope.querySelector("[data-card-copy]");
        if (dl) dl.onclick = () => downloadCard(v);
        if (cp) cp.onclick = async () => { const ok = await copyText(link); cp.textContent = ok ? "Copied ✓" : "Couldn't copy"; setTimeout(() => { cp.textContent = "Copy link"; }, 1800); };
    }

    // Draw the same card onto a canvas so it can be saved as a picture
    function downloadCard(v) {
        const W = 900, H = 1040, c = document.createElement("canvas");
        c.width = W; c.height = H;
        const g = c.getContext("2d");
        const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
        g.fillStyle = "#F5F4FA"; g.fillRect(0, 0, W, H);
        g.save(); round(40, 40, W - 80, H - 80, 44); g.clip();
        g.fillStyle = "#FFFFFF"; g.fillRect(40, 40, W - 80, H - 80);
        const grad = g.createLinearGradient(40, 40, W - 40, 360);
        grad.addColorStop(0, "#7E4FD8"); grad.addColorStop(1, "#5B2FB8");
        g.fillStyle = grad; g.fillRect(40, 40, W - 80, 320);
        g.restore();
        const star = (cx, cy, r) => { g.beginPath(); g.moveTo(cx, cy - r); g.bezierCurveTo(cx + r * 0.08, cy - r * 0.08, cx + r * 0.08, cy - r * 0.08, cx + r, cy); g.bezierCurveTo(cx + r * 0.08, cy + r * 0.08, cx + r * 0.08, cy + r * 0.08, cx, cy + r); g.bezierCurveTo(cx - r * 0.08, cy + r * 0.08, cx - r * 0.08, cy + r * 0.08, cx - r, cy); g.bezierCurveTo(cx - r * 0.08, cy - r * 0.08, cx - r * 0.08, cy - r * 0.08, cx, cy - r); g.fill(); };
        g.fillStyle = "#FFFFFF";
        star(104, 118, 18); star(770, 150, 54);
        g.font = "600 30px Outfit, sans-serif"; g.textBaseline = "middle";
        try { g.letterSpacing = "7px"; } catch (e) {}
        g.fillText("VERITY", 136, 120);
        try { g.letterSpacing = "0px"; } catch (e) {}
        g.font = "600 92px Outfit, sans-serif"; g.fillText("I voted.", 86, 232);
        g.globalAlpha = 0.88; g.font = "400 28px 'Google Sans', sans-serif"; g.fillText("Verified on the Ethereum blockchain", 88, 306); g.globalAlpha = 1;

        const label = (t, y) => { g.fillStyle = "#8B8F98"; g.font = "700 19px 'Google Sans', sans-serif"; try { g.letterSpacing = "3px"; } catch (e) {} g.fillText(t.toUpperCase(), 88, y); try { g.letterSpacing = "0px"; } catch (e) {} };
        const value = (t, y, font) => { g.fillStyle = "#111518"; g.font = font || "400 30px 'Google Sans', sans-serif"; g.fillText(t, 88, y); };
        // poll title, wrapped to two lines
        label("Poll", 420);
        g.font = "500 32px 'Google Sans', sans-serif";
        const words = String(v.poll).split(" "), lines = [""];
        words.forEach((w) => { const t = lines[lines.length - 1] ? lines[lines.length - 1] + " " + w : w; if (g.measureText(t).width > 470 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; });
        if (lines.length > 2) { lines[1] = lines[1].slice(0, 26) + "…"; lines.length = 2; }
        g.fillStyle = "#111518"; lines.forEach((ln, i) => g.fillText(ln, 88, 462 + i * 42));
        const y0 = 462 + lines.length * 42 + 26;
        label("Voter", y0); value(short(v.voter), y0 + 40, "400 30px ui-monospace, Menlo, monospace");
        const when = v.time ? new Date(v.time).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
        label("Block · Time", y0 + 104); value("#" + num(v.block) + (when ? " · " + when : ""), y0 + 144, "400 27px 'Google Sans', sans-serif");
        label("Transaction", y0 + 208); value(v.hash.slice(0, 14) + "…" + v.hash.slice(-10), y0 + 248, "400 26px ui-monospace, Menlo, monospace");

        const m = qrMatrix("https://sepolia.etherscan.io/tx/" + v.hash);
        if (m) {
            const size = 230, x0 = W - 88 - size, yq = 420, cell = size / m.length;
            g.strokeStyle = "#E3DDF0"; g.lineWidth = 2; round(x0 - 16, yq - 16, size + 32, size + 70, 20); g.stroke();
            g.fillStyle = "#5B2FB8";
            m.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect(x0 + x * cell, yq + y * cell, cell + 0.5, cell + 0.5); }));
            g.fillStyle = "#8B8F98"; g.font = "400 17px 'Google Sans', sans-serif"; g.textAlign = "center";
            g.fillText("Scan to verify on Etherscan", x0 + size / 2, yq + size + 28); g.textAlign = "left";
        }
        g.setLineDash([10, 10]); g.strokeStyle = "#E3DDF0"; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 880); g.lineTo(W - 40, 880); g.stroke(); g.setLineDash([]);
        g.fillStyle = "#5B2FB8"; g.font = "500 26px 'Google Sans', sans-serif"; g.fillText(SITE.replace(/^https?:\/\//, ""), 88, 938);
        g.fillStyle = "#8B8F98"; g.font = "400 22px 'Google Sans', sans-serif"; g.textAlign = "right"; g.fillText("One wallet, one vote", W - 88, 938); g.textAlign = "left";

        c.toBlob((blob) => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "verity-i-voted.png";
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }, "image/png");
    }

    // Standalone card (My Activity > Receipt)
    window.showVoteCard = function (v) {
        const modal = openModal(`<button class="x-close" data-x-close aria-label="Close">✕</button>${cardHTML(v)}`);
        modal.el.classList.add("bare");
        wireCard(modal.el, v);
    };

    // The tracker shown while a vote is being confirmed
    let journey = null;
    window.voteJourney = {
        start(info) {
            const wallet = typeof walletName === "function" ? walletName() : "your wallet";
            const modal = openModal(`
                <div class="xj-left">
                    <p class="x-kicker" id="xjKicker">Waiting for you to approve in ${esc(wallet)}…</p>
                    <h2>${esc(info.option)}</h2>
                    <p class="x-sub">${esc(info.poll)}</p>
                    <div class="xj-steps" data-at="1">
                        <span class="xj-trav">${SPARK}</span>
                        <div class="xj-step now" data-s="1"><div class="dot">1</div><b>Signed</b><small>Approve it in ${esc(wallet)}</small></div>
                        <div class="xj-step" data-s="2"><div class="dot">2</div><b>Sent</b><small>Broadcast to the Sepolia network</small></div>
                        <div class="xj-step" data-s="3"><div class="dot">3</div><b>In a block</b><small id="xjBlockText">Waiting for the next block</small></div>
                        <div class="xj-step" data-s="4"><div class="dot">4</div><b>Confirmed</b><small>Permanent. Nobody can change it</small></div>
                    </div>
                    <div class="xj-blocks hidden" id="xjBlocks"></div>
                    <p class="x-note" id="xjNote">Nothing is sent until you approve. This usually takes about 15 seconds after that.</p>
                    <div class="x-foot"><span></span><span class="x-btns"><button class="small-btn" data-x-close id="xjHide">Hide</button></span></div>
                </div>
                <div class="xj-right hidden" id="xjCard"></div>`, { wide: true, onClose: () => { journey = null; } });
            modal.el.classList.add("journey");
            journey = { modal, info };
        },
        _step(n) {
            if (!journey) return;
            const el = journey.modal.el;
            el.querySelector(".xj-steps").dataset.at = String(n);
            el.querySelectorAll(".xj-step").forEach((s) => {
                const k = Number(s.dataset.s);
                s.classList.toggle("done", k < n || n === 5);
                s.classList.toggle("now", k === n);
                if (k < n || n === 5) s.querySelector(".dot").textContent = "✓";
            });
        },
        sent(hash) {
            if (!journey) return;
            journey.hash = hash;
            this._step(3);
            journey.modal.el.querySelector("#xjKicker").textContent = "Your vote is on its way";
            journey.modal.el.querySelector("#xjNote").innerHTML = `Sent. Waiting for Sepolia to pack it into a block… <a href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noopener">watch on Etherscan ↗</a>`;
        },
        async mined(receipt) {
            if (!journey) { toast("Vote recorded on Sepolia ✓", "good"); return; }
            const j = journey, el = j.modal.el, bn = receipt.blockNumber;
            el.querySelector("#xjBlockText").innerHTML = `Packed into block <span class="mono">#${num(bn)}</span>`;
            el.querySelector("#xjKicker").textContent = "Your vote is in a block";
            const strip = el.querySelector("#xjBlocks");
            strip.classList.remove("hidden");
            strip.innerHTML = [bn - 2, bn - 1].map((b) => `<div class="blk" data-b="${b}"><b>#${num(b)}</b><span>…</span></div><i>—</i>`).join("") +
                `<div class="blk mine"><b>#${num(bn)}</b><span>your vote is in here ✦</span></div><i>—</i><div class="blk next"><b>next block</b><span>in ~12 s</span></div>`;
            // how busy were the neighbouring blocks? (real numbers, filled in as they arrive)
            [bn - 2, bn - 1].forEach((b) => readProvider.getBlock(b).then((blk) => {
                const cell = strip.querySelector(`[data-b="${b}"] span`);
                if (cell && blk) cell.textContent = `${blk.transactions.length} txs`;
            }).catch(() => {}));
            await sleep(1100);
            if (journey !== j) return;
            this._step(5);
            el.querySelector("#xjKicker").textContent = "Confirmed on Ethereum Sepolia";
            el.querySelector("#xjNote").textContent = "Done. Your vote is permanent and anyone can verify it.";
            el.querySelector("#xjHide").textContent = "Done";
            let time = Date.now();
            try { time = await blockTime(bn); } catch (err) {}
            if (journey !== j) return;
            const v = { poll: j.info.poll, hash: receipt.hash || j.hash, block: bn, time, voter: currentAccount };
            const side = el.querySelector("#xjCard");
            side.innerHTML = cardHTML(v);
            side.classList.remove("hidden");
            el.classList.add("with-card");
            wireCard(side, v);
        },
        close() { if (journey) journey.modal.close(); }
    };


    /* ---------- Buttons anywhere on the page ---------- */
    document.addEventListener("click", (e) => {
        const p = e.target.closest("[data-present]");
        const r = e.target.closest("[data-recount]");
        if (p) { e.preventDefault(); e.stopPropagation(); present(Number(p.dataset.present)); }
        else if (r) { e.preventDefault(); e.stopPropagation(); recount(Number(r.dataset.recount)); }
    });

    // live.html?poll=5&present=1 opens straight into presenter mode
    const q = new URLSearchParams(location.search);
    if (q.get("present") && q.get("poll") !== null) {
        const go = () => present(Number(q.get("poll")));
        if (typeof walletReady !== "undefined" && walletReady) go(); else document.addEventListener("wallet-ready", go, { once: true });
    }
})();
