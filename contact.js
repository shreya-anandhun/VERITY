// Contact page: builds an email from the form (VERITY has no server, so there's nothing to POST to)
(function () {
    const TO = "verity.helpdesk@gmail.com";
    const form = document.getElementById("contactForm");
    const topic = document.getElementById("ctTopic");
    const pollRow = document.getElementById("ctPollRow");
    const err = document.getElementById("ctErr");
    const done = document.getElementById("ctDone");

    // contact.html?report=4 arrives from a poll page's "Report this poll" link
    const params = new URLSearchParams(location.search);
    if (params.has("report")) {
        topic.value = "report";
        document.getElementById("ctPoll").value = params.get("report");
    }
    const showPoll = () => pollRow.classList.toggle("hidden", topic.value !== "report");
    topic.addEventListener("change", showPoll); showPoll();

    const fail = (msg) => { err.textContent = msg; err.classList.remove("hidden"); };
    const build = () => {
        err.classList.add("hidden");
        const name = form.name.value.trim(), email = form.email.value.trim(), msg = form.message.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Please enter an email address we can reply to.");
        if (msg.length < 10) return fail("Please write a few more words so we can help.");
        const label = topic.options[topic.selectedIndex].text;
        const poll = topic.value === "report" ? form.poll.value.trim() : "";
        if (topic.value === "report" && poll === "") return fail("Please give the poll number you're reporting.");
        const subject = `VERITY - ${label}${poll ? ` (poll #${poll})` : ""}`;
        const body = [`From: ${name || "(no name given)"} <${email}>`, `Topic: ${label}`, poll ? `Poll: #${poll} (${location.origin}/poll/${poll})` : "", "", msg, "", `Sent from ${location.origin}/contact`].filter((l) => l !== null).join("\n");
        return { subject, body };
    };

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const m = build(); if (!m) return;
        location.href = `mailto:${TO}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
        form.classList.add("hidden"); done.classList.remove("hidden");
    });
    document.getElementById("ctCopy").addEventListener("click", async () => {
        const m = build(); if (!m) return;
        const text = `To: ${TO}\nSubject: ${m.subject}\n\n${m.body}`;
        try { await navigator.clipboard.writeText(text); toast("Message copied. Paste it into any email to " + TO, "good"); }
        catch (e) { fail("Couldn't copy automatically. Email " + TO + " directly."); }
    });
    document.getElementById("ctAgain").addEventListener("click", () => { done.classList.add("hidden"); form.classList.remove("hidden"); form.message.value = ""; });
})();
