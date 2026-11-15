/* ==========================================================================
   fx.js - VERITY's motion + decor (ported from Block by Block)
   1. Sparkles that float and twinkle behind every page
   2. Cards that bob, tilt in 3D towards the pointer, and glow
   3. Hover (or tap) a highlighted word for a plain-English definition
   ========================================================================== */
(function () {
    "use strict";
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    var small = window.matchMedia("(max-width: 860px)");

    /* ---------- 1. Sky ---------- */
    var sky = document.createElement("div");
    sky.className = "fx-sky";
    sky.setAttribute("aria-hidden", "true");
    var html = '<span class="fx-aurora a"></span><span class="fx-aurora b"></span><span class="fx-aurora c"></span>';
    // Same sparkle positions every visit (a tiny seeded random), different per page
    var seed = 0, path = location.pathname;
    for (var c = 0; c < path.length; c++) seed = (seed * 31 + path.charCodeAt(c)) >>> 0;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var count = small.matches ? 3 : 6;
    for (var n = 0; n < count; n++) {
        // Desktop: sparkles live in the gutters either side of the content, never over buttons
        var x = small.matches ? rnd() * 92 + 2 : (n % 2 ? 85 + rnd() * 10 : 16.5 + rnd() * 4.5);
        html += '<span class="fx-spark" style="--x:' + x.toFixed(1) + '%;--y:' + (rnd() * 90 + 3).toFixed(1) +
                '%;--s:' + (0.45 + rnd() * 0.75).toFixed(2) + ';--d:' + (rnd() * 6).toFixed(2) + 's;--t:' +
                (2.6 + rnd() * 1.4).toFixed(2) + 's;--f:' + (6 + rnd() * 3).toFixed(1) + 's"><i></i></span>';
    }
    sky.innerHTML = html;
    document.body.prepend(sky);

    /* ---------- 2. Cards ---------- */
    // tilt + bob: tile-like cards.  glow only: cards full of controls (a moving form is annoying)
    var TILT = ".hstat, .hhow, .act-tile, .demo-step, .live-card:not(.expanded)";
    var GLOW = ".set-group, .poll-row, .result-row, .tl-card, .verify-bar, .demo-video, .live-card.expanded, .flow-step";
    var BOB  = ".hstat, .hhow, .act-tile, .demo-step, .live-card:not(.expanded)";

    // For the first few seconds after a page opens, every box slides in from the sides
    // (later refreshes, like Live Polls updating every 15 s, don't replay it)
    var opening = true, slideCount = 0;
    setTimeout(function () { opening = false; }, 4000);
    var isHome = !!document.querySelector(".content.home");      // Home has its own entrance

    function dress(root) {
        root.querySelectorAll(TILT + "," + GLOW).forEach(function (el, i) {
            if (el.classList.contains("fx-card")) return;
            el.classList.add("fx-card");
            if (opening && !isHome && !reduce.matches) {
                var n = slideCount++;
                el.style.setProperty("--from", n % 2 ? "translateX(48px)" : "translateX(-48px)");
                el.style.setProperty("--i", Math.min(n, 6));
                el.classList.add("fx-slide");
                el.addEventListener("animationend", function done(e) {
                    if (e.animationName !== "fx-slide") return;
                    el.classList.remove("fx-slide"); el.removeEventListener("animationend", done);
                });
            }
            if (el.matches(TILT)) el.classList.add("fx-tilt");
            if (el.matches(BOB)) el.classList.add("fx-bob");
            var spot = document.createElement("span");
            spot.className = "fx-spot";
            spot.setAttribute("aria-hidden", "true");
            el.prepend(spot);
        });
        // an expanded poll must sit still
        root.querySelectorAll(".live-card.expanded.fx-tilt").forEach(function (el) {
            el.classList.remove("fx-tilt", "fx-bob"); el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
        });
    }
    dress(document);

    document.addEventListener("pointermove", function (e) {
        var card = e.target.closest && e.target.closest(".fx-card");
        if (!card) return;
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
        card.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
        if (card.classList.contains("fx-tilt") && e.pointerType === "mouse" && !reduce.matches) {
            card.style.setProperty("--rx", (-(py - 0.5) * 10).toFixed(2) + "deg");
            card.style.setProperty("--ry", ((px - 0.5) * 10).toFixed(2) + "deg");
        }
    }, { passive: true });
    document.addEventListener("pointerout", function (e) {
        var card = e.target.closest && e.target.closest(".fx-tilt");
        if (card && !card.contains(e.relatedTarget)) { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); }
    }, { passive: true });

    // Home: once the slide-in has finished, hand the transform back so the cards can tilt
    var home = document.querySelector(".content.home");
    if (home) setTimeout(function () { home.classList.remove("enter"); }, 1300);

    /* ---------- Speed: start fetching a page the moment the pointer reaches its menu link ---------- */
    var fetched = {};
    document.querySelectorAll(".nav-item[href]").forEach(function (a) {
        a.addEventListener("pointerenter", function () {
            var href = a.getAttribute("href");
            if (fetched[href] || a.classList.contains("active")) return;
            fetched[href] = true;
            var l = document.createElement("link");
            l.rel = "prefetch"; l.href = href;
            document.head.appendChild(l);
        }, { passive: true });
    });

    /* ---------- 3. Hover definitions ---------- */
    /* Longest phrases first so "smart contract" wins over "contract". */
    var TERMS = [
        { re: /\btransaction hash(?:es)?\b|\btx hash\b/i, title: "Transaction hash", def: "A unique ID for one action on the blockchain, like a tracking number. Paste it into Etherscan to see exactly what happened." },
        { re: /\bsmart contracts?\b/i, title: "Smart contract", def: "A small program on the blockchain that runs by itself when its conditions are met. VERITY's contract counts the votes, so nobody can fiddle with them." },
        { re: /\bprivate keys?\b/i, title: "Private key", def: "Your secret password for the blockchain. It signs your transactions. Anyone who has it controls your wallet, so never share it." },
        { re: /\btest(?:\s|-)?net(?:work)?s?\b|\btest network\b/i, title: "Test network", def: "A practice copy of Ethereum where the coins are free and worth nothing, so you can try things safely." },
        { re: /\btest ETH\b/i, title: "Test ETH", def: "Free practice coins for the Sepolia test network. They pay the small fee for each vote and have no real value." },
        { re: /\bon-chain\b/i, title: "On-chain", def: "Saved on the blockchain itself, not on a company's server. Anyone can read it and nobody can quietly change it." },
        { re: /\bblockchains?\b/i, title: "Blockchain", def: "A shared record book copied on thousands of computers. New pages are added in linked blocks, so the past can't be quietly edited." },
        { re: /\bEtherscan\b/, title: "Etherscan", def: "A public website that lets anyone look up every transaction on Ethereum. Think of it as the blockchain's search engine." },
        { re: /\bEthereum\b/, title: "Ethereum", def: "A public blockchain that can run programs as well as move money. VERITY's voting rules live on it." },
        { re: /\bSepolia\b/, title: "Sepolia", def: "Ethereum's practice network. It works like the real one, but the coins are free, so voting here costs no real money." },
        { re: /\bPhantom\b/, title: "Phantom", def: "A wallet app that lives in your browser. It holds your keys and asks you to approve every vote before it is sent." },
        { re: /\bwallets?\b/i, title: "Wallet", def: "An app that holds your keys and proves who you are on the blockchain. On VERITY, one wallet means one vote." },
        { re: /\btransactions?\b/i, title: "Transaction", def: "Any action recorded on the blockchain, such as casting a vote or creating a poll. Each one is public and permanent." },
        { re: /\bimmutable\b/i, title: "Immutable", def: "Can't be changed once it is written. Not by you, not by us, not by anyone." },
        { re: /\bgas(?: fees?)?\b|\bfees?\b/i, title: "Gas fee", def: "A small payment to the network for recording your action. On Sepolia it is paid in free test ETH." },
        { re: /\breceipts?\b/i, title: "Receipt", def: "The public proof that your vote was recorded: its transaction hash, block number and time." },
        { re: /\bballots?\b/i, title: "Ballot", def: "Your single vote in a poll. Once it is on the blockchain it can't be edited or cast twice." },
        { re: /\bverif(?:y|ied|iable)\b/i, title: "Verify", def: "Check it yourself. Every vote can be looked up on a public explorer, so you don't have to take our word for it." }
    ];
    var TARGETS = [
        ".hero-text", ".hstat .sub", ".page-sub", ".section-sub", ".set-row small", ".set-note",
        ".flow-text p", ".faq p", ".chain-node", ".demo-step p", ".demo-placeholder p", ".welcome-text", ".pp-note", ".empty-poll", ".tl-card .meta"
    ].join(",");
    var SKIP = "a, button, input, select, textarea, code, svg, script, style, .tip, .mono, h1, h2, h3, h4";
    var master = new RegExp(TERMS.map(function (t) { return t.re.source; }).join("|"), "gi");

    function find(word) {
        for (var i = 0; i < TERMS.length; i++) {
            var re = new RegExp("^(?:" + TERMS[i].re.source + ")$", TERMS[i].re.flags.replace("g", ""));
            if (re.test(word)) return i;
        }
        return -1;
    }
    var usedOnPage = {};                             // each word is highlighted once per page, not every time
    function wrapIn(root) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.closest(SKIP)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var nodes = [], made = 0;
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            var text = node.nodeValue;
            master.lastIndex = 0;
            var match, last = 0, frag = null;
            while ((match = master.exec(text))) {
                if (made >= 2) break;                      // at most two highlighted words per block
                var idx = find(match[0]);
                if (idx < 0 || (usedOnPage[idx] && document.contains(usedOnPage[idx]))) continue;
                frag = frag || document.createDocumentFragment();
                frag.appendChild(document.createTextNode(text.slice(last, match.index)));
                var span = document.createElement("span");
                span.className = "tip";
                span.tabIndex = 0;
                span.dataset.tip = String(idx);
                span.textContent = match[0];
                usedOnPage[idx] = span; made++;
                frag.appendChild(span);
                last = match.index + match[0].length;
            }
            if (frag) {
                frag.appendChild(document.createTextNode(text.slice(last)));
                node.parentNode.replaceChild(frag, node);
            }
        });
    }
    function wrapAll() {
        document.querySelectorAll(TARGETS).forEach(function (el) {
            if (el.dataset.fxTips) return;
            el.dataset.fxTips = "1";
            wrapIn(el);
        });
    }
    wrapAll();

    // Cards and text that arrive later (polls loaded from the chain) get the same treatment
    var pending = null;
    new MutationObserver(function () {
        clearTimeout(pending);
        pending = setTimeout(function () { dress(document); wrapAll(); }, 150);
    }).observe(document.querySelector(".main") || document.body, { childList: true, subtree: true });

    /* One shared bubble, fixed to the viewport so nothing can clip it */
    var bubble = document.createElement("div");
    bubble.className = "tipbubble";
    bubble.setAttribute("role", "tooltip");
    bubble.id = "tipBubble";
    bubble.innerHTML =
        '<span class="tipbubble__ring" aria-hidden="true"></span>' +
        '<span class="tipbubble__head"><svg viewBox="-10 -10 20 20" aria-hidden="true"><path fill="currentColor" d="M0 -9 C1.2 -2.4 2.4 -1.2 9 0 C2.4 1.2 1.2 2.4 0 9 C-1.2 2.4 -2.4 1.2 -9 0 C-2.4 -1.2 -1.2 -2.4 0 -9Z"/></svg><strong></strong></span>' +
        '<p></p><span class="tipbubble__foot">VERITY decoder</span><span class="tipbubble__arrow" aria-hidden="true"></span>';
    document.body.appendChild(bubble);
    var titleEl = bubble.querySelector("strong");
    var defEl = bubble.querySelector("p");
    var arrow = bubble.querySelector(".tipbubble__arrow");
    var current = null, hideTimer = null;

    function show(el) {
        clearTimeout(hideTimer);
        var t = TERMS[+el.dataset.tip];
        if (!t) return;
        if (current && current !== el) current.classList.remove("is-open");
        current = el;
        el.classList.add("is-open");
        el.setAttribute("aria-describedby", "tipBubble");
        titleEl.textContent = t.title;
        defEl.textContent = t.def;
        bubble.classList.remove("is-on");
        bubble.style.left = "0px";
        bubble.style.top = "0px";
        var r = el.getBoundingClientRect();
        var b = bubble.getBoundingClientRect();
        var x = r.left + r.width / 2 - b.width / 2;
        x = Math.max(12, Math.min(x, window.innerWidth - b.width - 12));
        var above = r.top - b.height - 14 > 70;
        var y = above ? r.top - b.height - 14 : r.bottom + 14;
        bubble.style.left = x + "px";
        bubble.style.top = y + "px";
        bubble.dataset.side = above ? "top" : "bottom";
        arrow.style.left = Math.max(16, Math.min(r.left + r.width / 2 - x, b.width - 16)) + "px";
        void bubble.offsetWidth;
        bubble.classList.add("is-on");
    }
    function hide() {
        hideTimer = setTimeout(function () {
            bubble.classList.remove("is-on");
            if (current) { current.classList.remove("is-open"); current.removeAttribute("aria-describedby"); }
            current = null;
        }, 90);
    }
    document.addEventListener("mouseover", function (e) { var el = e.target.closest && e.target.closest(".tip"); if (el) show(el); });
    document.addEventListener("mouseout", function (e) { var el = e.target.closest && e.target.closest(".tip"); if (el && !el.contains(e.relatedTarget)) hide(); });
    document.addEventListener("focusin", function (e) { if (e.target.classList && e.target.classList.contains("tip")) show(e.target); });
    document.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("tip")) hide(); });
    document.addEventListener("click", function (e) {
        var el = e.target.closest && e.target.closest(".tip");
        if (el) { e.preventDefault(); if (current === el && bubble.classList.contains("is-on")) hide(); else show(el); }
        else if (current) hide();
    });
    window.addEventListener("scroll", function () { if (current) hide(); }, { passive: true });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && current) hide(); });
})();
