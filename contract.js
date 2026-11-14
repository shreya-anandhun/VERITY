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
    "https://1rpc.io/sepolia",
    "https://sepolia.gateway.tenderly.co"
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
            if (rpcIndex >= SEPOLIA_RPCS.length - 1 || attempt >= 2) throw err;
            console.log("RPC failed, switching node:", err.shortMessage || err.message);
            useRpc(rpcIndex + 1);
        }
    }
}

// Contract connected to Phantom, for WRITING (vote, create, close)
async function writeContract() {
    const provider = getProvider();
    if (!provider) throw new Error("Phantom not found");
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
function clearPollCache() {
    pollsCache = null;
    try { sessionStorage.removeItem(POLL_CACHE); } catch (err) {}
}

async function loadPolls(force = false) {
    if (!force) {
        if (pollsCache) return pollsCache;
        const c = cachedPolls();
        if (c) { pollsCache = c; return c; }
    }

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

    // Creation times: only look up polls we haven't seen before (from PollCreated events)
    if (polls.some((p) => !p.createdAt)) {
        try {
            const events = await queryEvents(readContract.filters.PollCreated());
            const blocks = [...new Set(events.map((e) => e.blockNumber))];
            const times = {};
            await Promise.all(blocks.map(async (bn) => { times[bn] = (await readProvider.getBlock(bn)).timestamp * 1000; }));
            for (const ev of events) {
                const poll = polls[Number(ev.args.pollId)];
                if (poll) { poll.createdAt = times[ev.blockNumber]; created[poll.id] = poll.createdAt; }
            }
            setSetting("created", created);
        } catch (err) { console.log("Could not read creation times", err); }
    }

    const shown = polls.filter((p) => !HIDDEN_POLLS.includes(p.id));
    pollsCache = shown;
    try { sessionStorage.setItem(POLL_CACHE, JSON.stringify({ time: Date.now(), polls: shown })); } catch (err) {}
    return shown;
}

// Which option did this wallet pick in each poll? { pollId: optionIndex }
async function loadMyVotes(address, polls) {
    const mine = {};
    if (!address) return mine;
    const flags = await withFailover(() => Promise.all(polls.map((p) => readContract.hasVoted(p.id, address))));
    const picks = await withFailover(() => Promise.all(polls.map((p, i) => flags[i] ? readContract.votedFor(p.id, address) : null)));
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
    return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
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
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
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
    if (!pollCard) return;
    try {
        const polls = await loadPolls();
        const live = polls.filter((p) => p.isOpen && p.endTime > Date.now());
        livePollCount = live.length;
        setText("liveCount", live.length);
        setText("totalPolls", polls.length);
        setText("totalVotes", polls.reduce((n, p) => n + p.totalVotes, 0).toLocaleString("en-IN"));
        setText("liveWord", live.length === 1 ? "poll" : "polls");

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
document.addEventListener("wallet-connected", loadHome);
document.addEventListener("wallet-disconnected", loadHome);
