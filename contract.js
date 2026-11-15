/* =========================================================
   VERITY — contract.js
   Talks to the Voting contract on Sepolia through ethers.js.
   Loaded on every page after app.js.
   ========================================================= */

const VOTING_ABI = [
    "function createPoll(string title, string category, string[] options, uint256 endTime) returns (uint256)",
    "function vote(uint256 pollId, uint256 optionIndex)",
    "function closePoll(uint256 pollId)",
    "function pollCount() view returns (uint256)",
    "function getPoll(uint256 pollId) view returns (string title, string category, string[] options, uint256[] votes, address creator, uint256 endTime, bool isOpen, uint256 totalVotes)",
    "function hasVoted(uint256 pollId, address voter) view returns (bool)",
    "function votedFor(uint256 pollId, address voter) view returns (uint256)",
    "event PollCreated(uint256 indexed pollId, address indexed creator, string title, string category)",
    "event Voted(uint256 indexed pollId, address indexed voter, uint256 optionIndex)",
    "event PollClosed(uint256 indexed pollId)"
];

// Polls hidden from the site (they still exist on-chain; nothing can delete them).
// Add a poll's ID here to stop VERITY showing it anywhere.
const HIDDEN_POLLS = [3];

// Public Sepolia nodes for READING (works even with no wallet connected).
// We talk to one node at a time; if it errors, we move to the next in the list.
const SEPOLIA_RPCS = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.gateway.tenderly.co",
    "https://1rpc.io/sepolia"
];
const SEPOLIA_NET = { chainId: 11155111, name: "sepolia" };
let rpcIndex = 0;
let readProvider, readContract;
function useRpc(i) {
    rpcIndex = i;
    readProvider = new ethers.JsonRpcProvider(SEPOLIA_RPCS[i], SEPOLIA_NET, { staticNetwork: true });
    readProvider.pollingInterval = 2000;          // notice confirmations sooner (default is 4s)
    readContract = new ethers.Contract(CONTRACT_ADDRESS, VOTING_ABI, readProvider);
}
useRpc(0);
// Run a read; if the node fails, switch to the next one and try again
async function withFailover(fn) {
    for (let attempt = 0; ; attempt++) {
        try { return await fn(); }
        catch (err) {
            if (attempt >= SEPOLIA_RPCS.length) throw err;
            console.log("RPC failed, switching node:", err.shortMessage || err.message);
            useRpc((rpcIndex + 1) % SEPOLIA_RPCS.length);   // go round the list, back to the first if needed
        }
    }
}

// The block the contract was deployed in: no events exist before it
const DEPLOY_BLOCK = 12120000;

// Public nodes only allow 50,000 blocks per event query, so we ask in chunks
async function queryEvents(filter) {
    return withFailover(() => queryEventsOnce(filter));
}
async function queryEventsOnce(filter) {
    const latest = await readProvider.getBlockNumber();
    const STEP = 49000;
    const all = [];
    for (let from = DEPLOY_BLOCK; from <= latest; from += STEP + 1) {
        // For the newest chunk ask up to "latest" by name: public nodes sit behind a load
        // balancer, and one that is a block behind rejects a block number it hasn't seen yet
        const to = from + STEP >= latest ? "latest" : from + STEP;
        all.push(...await readContract.queryFilter(filter, from, to));
    }
    return all;
}

// Contract connected to Phantom, for WRITING (vote, create, close)
async function writeContract() {
    const provider = getProvider();
    if (!provider) throw new Error("Phantom not found");
    // Safety: never send a vote on the wrong network (e.g. real Ethereum). Sepolia only.
    let chain = await provider.request({ method: "eth_chainId" }).catch(() => null);
    if (chain && Number(chain) !== 11155111) {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] }).catch(() => {});
        chain = await provider.request({ method: "eth_chainId" }).catch(() => null);
        if (chain && Number(chain) !== 11155111) throw new Error(walletName() === "MetaMask"
            ? "MetaMask isn't on the Sepolia test network. Open MetaMask, pick Sepolia from the network list (turn on Show test networks if it's hidden), then try again."
            : "Phantom isn't on the Sepolia test network. In Phantom: Settings, Developer Settings, turn on Testnet Mode, then try again.");
    }
    const browserProvider = new ethers.BrowserProvider(provider);
    const signer = await browserProvider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, VOTING_ABI, signer);
}


/* ---------- Read all polls ---------- */
// Returns [{ id, question, category, options, votes, creator, endTime(ms), isOpen, totalVotes, createdAt(ms) }]
let pollsCache = null;
const POLL_CACHE = "verity-polls-cache";     // sessionStorage: instant paint when moving between pages
const CREATED_CACHE = "verity-created";      // localStorage: creation times never change, so keep them

function cachedPolls() {
    try {
        const c = JSON.parse(sessionStorage.getItem(POLL_CACHE));
        if (c && Date.now() - c.time < 45000) return c.polls;   // fresh enough for 45s
    } catch (err) {}
    return null;
}
const POLL_LAST = "verity-polls-last";       // localStorage: the last list we saw, shown instantly on the next visit
function clearPollCache() {
    pollsCache = null;
    try { sessionStorage.removeItem(POLL_CACHE); localStorage.removeItem(POLL_LAST); } catch (err) {}
}

// Speed: show what we saw last time straight away, then quietly check the chain
// and tell the page ("polls-fresh") if anything changed.
let refreshing = null;
function refreshPollsQuietly() {
    if (refreshing) return refreshing;
    const before = JSON.stringify(pollsCache);
    refreshing = loadPolls(true)
        .then((fresh) => { if (JSON.stringify(fresh) !== before) document.dispatchEvent(new Event("polls-fresh")); })
        .catch((err) => console.log("Background refresh failed", err))
        .finally(() => { refreshing = null; });
    return refreshing;
}

async function loadPolls(force = false) {
    if (!force) {
        if (pollsCache) return pollsCache;
        const c = cachedPolls();
        if (c) { pollsCache = c; return c; }
        try {
            const last = JSON.parse(localStorage.getItem(POLL_LAST));
            if (Array.isArray(last)) { pollsCache = last; refreshPollsQuietly(); return last; }
        } catch (err) {}
    }

    if (inflight) return inflight;                 // two parts of a page asking at once share one request
    inflight = fetchPolls().finally(() => { inflight = null; });
    return inflight;
}
let inflight = null;

async function fetchPolls() {
    const raw = await withFailover(async () => {
        const count = Number(await readContract.pollCount());
        // Ask for every poll at once instead of one after another
        return Promise.all(Array.from({ length: count }, (_, i) => readContract.getPoll(i)));
    });
    const created = getSetting("created", {});
    const polls = raw.map((p, i) => ({
        id: i,
        question: p.title,
        category: p.category || "Other",
        options: [...p.options],
        votes: p.votes.map((v) => Number(v)),
        creator: p.creator,
        endTime: Number(p.endTime) * 1000,
        isOpen: p.isOpen,
        totalVotes: Number(p.totalVotes),
        createdAt: created[i] || 0
    }));

    const shown = polls.filter((p) => !HIDDEN_POLLS.includes(p.id));
    savePolls(shown);

    // Creation times need a slow search through old events. Don't make the page wait:
    // show the polls now and fill the times in when they arrive.
    if (polls.some((p) => !p.createdAt)) {
        (async () => {
            try {
                const events = await queryEvents(readContract.filters.PollCreated());
                const blocks = [...new Set(events.map((e) => e.blockNumber))];
                const times = {};
                await Promise.all(blocks.map(async (bn) => { times[bn] = await blockTime(bn); }));
                for (const ev of events) {
                    const poll = polls[Number(ev.args.pollId)];
                    if (poll) { poll.createdAt = times[ev.blockNumber]; created[poll.id] = poll.createdAt; }
                }
                setSetting("created", created);
                if (pollsCache === shown) { savePolls(shown); document.dispatchEvent(new Event("polls-fresh")); }
            } catch (err) { console.log("Could not read creation times", err); }
        })();
    }
    return shown;
}
function savePolls(shown) {
    pollsCache = shown;
    try {
        sessionStorage.setItem(POLL_CACHE, JSON.stringify({ time: Date.now(), polls: shown }));
        localStorage.setItem(POLL_LAST, JSON.stringify(shown));
    } catch (err) {}
}

// Which option did this wallet pick in each poll? { pollId: optionIndex }
async function loadMyVotes(address, polls) {
    const mine = {};
    if (!address) return mine;
    // Both questions go out together (one round trip instead of two)
    const [flags, picks] = await withFailover(() => Promise.all([
        Promise.all(polls.map((p) => readContract.hasVoted(p.id, address))),
        Promise.all(polls.map((p) => readContract.votedFor(p.id, address)))
    ]));
    polls.forEach((p, i) => { if (flags[i]) mine[p.id] = Number(picks[i]); });
    return mine;
}


// The transaction hash of this wallet's vote in each poll: { pollId: hash }
let myVoteTxCache = { address: null, map: {} };
async function loadMyVoteTxs(address) {
    if (!address) return {};
    if (myVoteTxCache.address === address.toLowerCase()) return myVoteTxCache.map;
    const map = {};
    try {
        const evs = await queryEvents(readContract.filters.Voted(null, address));
        for (const ev of evs) map[Number(ev.args.pollId)] = ev.transactionHash;
    } catch (err) { console.log("Could not read vote transactions", err); }
    myVoteTxCache = { address: address.toLowerCase(), map };
    return map;
}


// The network fee for an action, before you sign it. Fills an element like <p id="feeLine">.
// (Estimates from the public node; the wallet shows the exact amount when it asks you.)
async function showFeeEstimate(el, method, args) {
    if (!el) return;
    el.innerHTML = "Network fee: <b>estimating…</b> · VERITY charges nothing";
    try {
        const [gas, fee] = await Promise.all([
            readContract[method].estimateGas(...args, { from: currentAccount }),
            readProvider.getFeeData()
        ]);
        const wei = gas * (fee.maxFeePerGas || fee.gasPrice || 0n);
        const eth = Number(ethers.formatEther(wei));
        const text = eth < 0.000001 ? "less than 0.000001" : "about " + eth.toPrecision(2);
        el.innerHTML = `Network fee: <b>${text} test ETH</b> (free Sepolia coins) · VERITY charges nothing`;
    } catch (err) {
        el.innerHTML = "Network fee: <b>a tiny amount of free test ETH</b> · VERITY charges nothing";
    }
}

// Every poll has its own page: /poll/7 on the live site (poll.html?id=7 when opened as a local file)
function pollLink(id, absolute) {
    if (location.protocol === "file:") return "poll.html?id=" + id;
    return (absolute ? location.origin : "") + "/poll/" + id;
}

// Start fetching the polls the moment this file loads, before the wallet check finishes
loadPolls().catch(() => {});


/* ---------- Pending + failed transactions (remembered in this browser) ---------- */
// A reverted transaction leaves no event on-chain, so we note it here for the Transactions page.
function rememberTx(list, tx) {
    const all = getSetting(list, []);
    all.unshift(tx);
    setSetting(list, all.slice(0, 50));
}
function forgetTx(list, hash) {
    setSetting(list, getSetting(list, []).filter((t) => t.hash !== hash));
}

// Turn an ethers error into something a person can read
function friendlyError(err) {
    const msg = (err && (err.reason || err.shortMessage || err.message)) || "Something went wrong";
    if (/user rejected|user denied|rejected the request/i.test(msg)) return null;   // they pressed Cancel in Phantom: not an error
    if (/Already voted/i.test(msg)) return "This wallet has already voted in this poll";
    if (/Poll is closed/i.test(msg)) return "This poll has closed";
    if (/insufficient funds/i.test(msg)) return "Not enough Sepolia ETH for the network fee";
    if (/Only the creator/i.test(msg)) return "Only the poll's creator can close it";
    if (/missing revert data|execution reverted|CALL_EXCEPTION/i.test(msg)) return "The network rejected this. Most likely this wallet already voted, or the poll has closed.";
    return msg.length > 170 ? msg.slice(0, 170) + "…" : msg;
}


/* ---------- Send a transaction and track it ---------- */
// kind: "vote" | "create" | "close".  info: { poll, option }
// Returns the receipt, or null if the user cancelled. Throws on revert.
async function sendTx(kind, info, call, onSent) {
    let tx;
    try {
        const contract = await writeContract();
        tx = await call(contract);
    } catch (err) {
        const text = friendlyError(err);
        if (!text) return null;                                   // cancelled in Phantom
        rememberTx("failed", { hash: "", type: kind, poll: info.poll, option: info.option, time: Date.now(), reason: text });
        throw new Error(text);
    }

    myVoteTxCache = { address: null, map: {} };
    rememberTx("pending", { hash: tx.hash, type: kind, poll: info.poll, option: info.option, time: Date.now() });
    document.dispatchEvent(new CustomEvent("verity-tx", { detail: { hash: tx.hash, kind } }));
    if (onSent) { try { onSent(tx.hash); } catch (err) {} }

    // Wait for the block through our own node (polls every 2s), not the wallet's
    const receipt = await readProvider.waitForTransaction(tx.hash, 1, 180000);
    forgetTx("pending", tx.hash);
    clearPollCache();                                             // numbers changed
    if (receipt.status !== 1) {
        rememberTx("failed", { hash: tx.hash, type: kind, poll: info.poll, option: info.option, time: Date.now(), reason: "The network rejected this transaction" });
        throw new Error("The network rejected this transaction");
    }
    return receipt;
}


/* ---------- Block timestamps (cached: a block's time never changes) ---------- */
async function blockTime(bn) {
    const cache = getSetting("blocktimes", {});
    if (cache[bn]) return cache[bn];
    const t = (await readProvider.getBlock(bn)).timestamp * 1000;
    cache[bn] = t;
    setSetting("blocktimes", cache);
    return t;
}


/* ---------- Toast (small message bottom-centre) ---------- */
function toast(text, kind = "") {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = text;
    el.className = "toast show " + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 4200);
}


/* ---------- Profile panel: real numbers ---------- */
async function fillProfile(address) {
    if (!address) return;
    try {
        const polls = await loadPolls();
        const mine = await loadMyVotes(address, polls);
        const voted = Object.keys(mine).length;
        const created = polls.filter((p) => p.creator.toLowerCase() === address.toLowerCase()).length;
        setText("statVoted", voted);
        setText("statCreated", created);
        const list = document.getElementById("ppVotes");
        if (list) {
            list.innerHTML = voted
                ? Object.entries(mine).slice(-5).reverse().map(([id, opt]) => {
                    const p = polls.find((x) => x.id === Number(id)) || { question: "Poll #" + id, options: [] };
                    return `<li><span class="muted">${escapeHTML(p.question)}</span><br>${escapeHTML(p.options[opt])}</li>`;
                }).join("")
                : '<li class="muted">No votes yet</li>';
        }
    } catch (err) { console.log("Profile load failed", err); }
}
document.addEventListener("wallet-connected", (e) => fillProfile(e.detail.address));


/* ---------- Home page ---------- */
async function loadHome() {
    const pollCard = document.getElementById("featuredPoll");
    if (!pollCard && !document.getElementById("liveCount")) return;
    try {
        const polls = await loadPolls();
        const live = polls.filter((p) => p.isOpen && p.endTime > Date.now());
        livePollCount = live.length;
        setText("liveCount", live.length);
        setText("totalPolls", polls.length);
        setText("totalVotes", polls.reduce((n, p) => n + p.totalVotes, 0).toLocaleString("en-IN"));
        setText("liveWord", live.length === 1 ? "poll" : "polls");
        document.querySelectorAll(".num-wait").forEach((el) => el.classList.remove("num-wait"));   // real numbers are in

        if (!pollCard) return;                       // Home no longer shows a featured poll
        if (!live.length) {
            featuredPoll = null;
            pollCard.classList.add("hidden");
            const e = document.getElementById("emptyPoll");
            e.textContent = "No polls currently live";
            e.classList.remove("hidden");
            return;
        }
        // Feature the busiest live poll
        const top = [...live].sort((a, b) => b.totalVotes - a.totalVotes)[0];
        featuredPoll = { question: top.question, voters: top.totalVotes, endTime: top.endTime };
        setText("pollQuestion", top.question);
        setText("voterCount", top.totalVotes.toLocaleString("en-IN"));
        const link = document.getElementById("featuredVoteLink");
        link.href = `live.html?poll=${top.id}`;
        let already = false;
        if (currentAccount) { try { already = await readContract.hasVoted(top.id, currentAccount); } catch (err) {} }
        link.firstChild.textContent = already ? "View your vote " : "Vote now ";
        pollCard.classList.remove("hidden");
        document.getElementById("emptyPoll").classList.add("hidden");
        updateCountdown();
    } catch (err) {
        console.log("Home load failed", err);
        toast("Something went wrong loading from Sepolia: " + (err.shortMessage || err.message).slice(0, 80), "bad");
    }
}
loadHome();
document.addEventListener("polls-fresh", loadHome);
// A poll can cross its end time while you're looking at the page: keep the live count honest
setInterval(() => { if (pollsCache && document.getElementById("liveCount")) loadHome(); }, 60000);
document.addEventListener("wallet-connected", loadHome);
document.addEventListener("wallet-disconnected", loadHome);
