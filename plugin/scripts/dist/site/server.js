import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { posix } from "node:path";
import { escapeHtml, FOLDER_RE, refOfFolder, TYPE_LABELS, TYPE_ORDER } from "./render.js";
import { SITE_CSS, SITE_JS } from "./assets.js";
/**
 * The local documentation viewer (phase 11): Node's http server on
 * 127.0.0.1, a random port, read-only. Security:
 * - binds 127.0.0.1 only;
 * - a one-time key in the start URL is exchanged for an HttpOnly,
 *   SameSite=Strict session cookie; every other request needs the cookie;
 * - the Host header must be 127.0.0.1:<port> or localhost:<port>, so a
 *   DNS-rebinding page cannot talk to it;
 * - GET and HEAD only; no token or GitHub URL with credentials reaches the
 *   browser; a strict Content-Security-Policy allows only this server.
 */
export const COOKIE = "idc365_view";
const PAGE_RE = /^(docs|code)\/[A-Za-z0-9._\-/]+\.html$/;
const token = () => randomBytes(24).toString("base64url");
function sameText(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}
/** The Host header must name this server exactly (DNS-rebinding protection). */
export function hostAllowed(host, port) {
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
export function parseCookies(header) {
    const out = {};
    for (const part of (header ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i > 0)
            out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
}
/** A page path from a URL, normalised with forward slashes; undefined for anything that is not a site page. */
export function safePage(raw) {
    let p;
    try {
        p = decodeURIComponent(raw);
    }
    catch {
        return undefined;
    }
    if (p.includes("\\") || p.includes("\0"))
        return undefined;
    const n = posix.normalize(p);
    if (n !== p || n.startsWith("..") || n.startsWith("/"))
        return undefined;
    return PAGE_RE.test(n) ? n : undefined;
}
const SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
};
function versionLabel(folder) {
    const ref = refOfFolder(folder);
    if (ref.startsWith("release/"))
        return `${ref.slice(8)} (planned)`;
    return ref;
}
function versionSort(a, b) {
    const rank = (f) => (f === "main" ? 0 : f.startsWith("release__") ? 1 : 2);
    if (rank(a) !== rank(b))
        return rank(a) - rank(b);
    const nums = (f) => (/v(\d+)\.(\d+)\.(\d+)/.exec(f) ?? []).slice(1).map(Number);
    const [x, y] = [nums(a), nums(b)];
    for (let i = 0; i < 3; i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0))
            return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
}
function layout(ctx, title, main, q = "", page = "") {
    const versions = ctx
        ? `<form class="version" action="/switch" method="get"><label for="v">Version</label> <select id="v" name="v">${ctx.versions
            .map((f) => `<option value="${escapeHtml(f)}"${f === ctx.folder ? " selected" : ""}>${escapeHtml(versionLabel(f))}</option>`)
            .join("")}</select><input type="hidden" name="p" value="${escapeHtml(page)}"><noscript><button>Go</button></noscript></form>`
        : "";
    const search = ctx
        ? `<form class="search" action="/search" method="get" role="search"><input type="hidden" name="v" value="${escapeHtml(ctx.folder)}"><input type="search" name="q" value="${escapeHtml(q)}" placeholder="Search ID, title or text" aria-label="Search"><button>Search</button></form>`
        : "";
    const nav = ctx ? navigation(ctx, page) : "";
    const notes = ctx?.notes.length ? ctx.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join("") : "";
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · IDC365 decisions</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script></head>
<body><header class="top"><a class="home" href="${ctx ? `/v/${escapeHtml(ctx.folder)}/` : "/"}">IDC365 decisions</a>${search}${versions}</header>
<div class="wrap">${nav}<main>${notes}${main}</main></div></body></html>
`;
}
function navigation(ctx, current) {
    const out = [`<nav class="side" aria-label="Documents">`];
    for (const type of TYPE_ORDER) {
        const docs = ctx.manifest.documents.filter((d) => d.type === type);
        out.push(`<h2>${escapeHtml(TYPE_LABELS[type] ?? type)}</h2>`);
        if (!docs.length) {
            out.push(`<p class="empty">None</p>`);
            continue;
        }
        out.push(`<ul>`);
        for (const d of docs) {
            const label = type === "shadow" ? d.title : `${d.id} ${d.title}`;
            out.push(`<li${d.page === current ? ' class="current"' : ""}><a href="/v/${escapeHtml(ctx.folder)}/${escapeHtml(d.page)}"${d.page === current ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a></li>`);
        }
        out.push(`</ul>`);
    }
    out.push(`</nav>`);
    return out.join("");
}
function badge(state) {
    return `<span class="badge s-${escapeHtml(state.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">${escapeHtml(state || "unknown")}</span>`;
}
/** Search over ID, title and body text; every term must match. An exact ID comes first. */
export function searchEntries(entries, query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return [];
    const terms = q.split(/\s+/);
    const idLike = /^([a-z]+)-?0*([0-9]+)$/.exec(q.replace(/\s+/g, ""));
    const scored = [];
    for (const e of entries) {
        const id = e.id.toLowerCase();
        const title = e.title.toLowerCase();
        const text = e.text.toLowerCase();
        let score = 0;
        if (id === q || (idLike && new RegExp(`^${idLike[1]}-0*${idLike[2]}$`).test(id)))
            score += 1000;
        let all = true;
        for (const t of terms) {
            if (id.includes(t))
                score += 50;
            else if (title.includes(t))
                score += 10;
            else if (text.includes(t))
                score += 1;
            else
                all = false;
        }
        if (score >= 1000 || all)
            scored.push({ e, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id)).map((s) => s.e);
}
export function createViewer(o) {
    let key = o.key ?? token();
    const secret = o.secret ?? token();
    let port = 0;
    const send = (res, status, body, type = "text/html; charset=utf-8", extra = {}) => {
        res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, ...extra });
        res.end(res.req.method === "HEAD" ? undefined : body);
    };
    const plain = (res, status, text) => send(res, status, `<!doctype html><meta charset="utf-8"><title>${status}</title><p>${escapeHtml(text)}</p>`);
    async function context(folder) {
        const [folders, m] = await Promise.all([o.source.folders(), o.source.manifest(folder)]);
        if (!m.data)
            return undefined;
        const notes = [];
        if (m.data.kind === "branch") {
            const sha = await o.source.indexSha(m.data.ref).catch(() => undefined);
            if (sha && sha !== m.data.sourceSha)
                notes.push("This page may not be up to date yet.");
        }
        const offline = o.source.offlineSince ?? m.offlineSince;
        if (offline)
            notes.push(`Offline: GitHub could not be reached; showing the copy cached at ${offline.slice(0, 16).replace("T", " ")} UTC.`);
        const versions = [...new Set([...folders, folder])].sort(versionSort);
        return { folder, manifest: m.data, versions, notes };
    }
    async function route(req, res) {
        if (!hostAllowed(req.headers.host, port))
            return plain(res, 421, "Unknown host.");
        if (req.method !== "GET" && req.method !== "HEAD")
            return plain(res, 405, "Read only.");
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        // One-time key → session cookie.
        const k = url.searchParams.get("key");
        if (url.pathname === "/" && k !== null) {
            if (key && sameText(k, key)) {
                key = undefined;
                return send(res, 302, "", "text/plain", { Location: "/", "Set-Cookie": `${COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
            }
            return plain(res, 403, "This start link was already used or is wrong. Run idc365-decisions view again for a new link.");
        }
        const cookie = parseCookies(req.headers.cookie)[COOKIE];
        if (!cookie || !sameText(cookie, secret))
            return plain(res, 403, "Open the link that idc365-decisions view printed.");
        if (url.pathname === "/assets/style.css")
            return send(res, 200, SITE_CSS, "text/css; charset=utf-8");
        if (url.pathname === "/assets/app.js")
            return send(res, 200, SITE_JS, "text/javascript; charset=utf-8");
        if (url.pathname === "/") {
            const folders = await o.source.folders();
            if (!folders.length)
                return send(res, 200, layout(undefined, "No site yet", `<h1>No rendered documentation yet</h1><p>The site workflow has not rendered ${escapeHtml(o.repository)} yet. Ask the owner to run it.</p>`));
            return send(res, 302, "", "text/plain", { Location: `/v/${folders.includes("main") ? "main" : folders.sort(versionSort)[0]}/` });
        }
        if (url.pathname === "/switch") {
            const v = url.searchParams.get("v") ?? "";
            if (!FOLDER_RE.test(v))
                return plain(res, 400, "Unknown version.");
            const p = safePage(url.searchParams.get("p") ?? "");
            const m = p ? await o.source.manifest(v) : undefined;
            const exists = p && m?.data?.documents.some((d) => d.page === p);
            return send(res, 302, "", "text/plain", { Location: `/v/${v}/${exists ? p : ""}` });
        }
        if (url.pathname === "/search") {
            const v = url.searchParams.get("v") ?? "main";
            if (!FOLDER_RE.test(v))
                return plain(res, 400, "Unknown version.");
            const ctx = await context(v);
            if (!ctx)
                return plain(res, 404, "This version is not rendered.");
            const q = url.searchParams.get("q") ?? "";
            const entries = (await o.source.search(v)).data ?? [];
            const hits = searchEntries(entries, q);
            const rows = hits.map((h) => `<li><a href="/v/${escapeHtml(v)}/${escapeHtml(h.page)}"><span class="id">${escapeHtml(h.id)}</span> ${escapeHtml(h.title)}</a> ${badge(h.state)}</li>`).join("");
            return send(res, 200, layout(ctx, `Search: ${q}`, `<h1>Search</h1><p class="count">${hits.length} result${hits.length === 1 ? "" : "s"} for “${escapeHtml(q)}” in ${escapeHtml(versionLabel(v))}</p><ul class="results">${rows}</ul>`, q));
        }
        const m = /^\/v\/([^/]+)\/(.*)$/.exec(url.pathname);
        if (m) {
            const folder = m[1];
            if (!FOLDER_RE.test(folder))
                return plain(res, 404, "Unknown version.");
            const ctx = await context(folder);
            if (!ctx)
                return plain(res, 404, "This version is not rendered.");
            if (m[2] === "") {
                const recent = [...ctx.manifest.documents].filter((d) => d.date).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id)).slice(0, 30);
                const rows = recent.map((d) => `<tr><td><a href="/v/${escapeHtml(folder)}/${escapeHtml(d.page)}">${escapeHtml(d.id.startsWith("CODE:") ? "CODE" : d.id)}</a></td><td>${escapeHtml(d.title)}</td><td>${badge(d.state)}</td><td>${escapeHtml((d.date ?? "").slice(0, 10))}</td></tr>`).join("");
                const main = `<h1>Recent changes</h1><p class="intro">${escapeHtml(o.repository)}, ${escapeHtml(versionLabel(folder))}: ${ctx.manifest.documents.length} documents.</p><table class="recent"><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`;
                return send(res, 200, layout(ctx, "Recent changes", main));
            }
            const page = safePage(m[2]);
            if (!page)
                return plain(res, 404, "Not a page.");
            const f = await o.source.page(folder, page);
            if (f.status !== 200)
                return send(res, 404, layout(ctx, "Not found", `<h1>Not in this version</h1><p>${escapeHtml(page)} does not exist in ${escapeHtml(versionLabel(folder))}.</p>`, "", page));
            const doc = ctx.manifest.documents.find((d) => d.page === page);
            return send(res, 200, layout(ctx, doc ? `${doc.id} ${doc.title}` : page, f.body, "", page));
        }
        return plain(res, 404, "Not found.");
    }
    const server = createServer((req, res) => {
        route(req, res).catch((err) => {
            if (!res.headersSent)
                plain(res, 502, `Could not load the page: ${err.message}`);
            else
                res.end();
        });
    });
    return {
        server,
        listen: (p = 0) => new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(p, "127.0.0.1", () => {
                port = server.address().port;
                resolve({ url: `http://127.0.0.1:${port}/?key=${key}`, port });
            });
        }),
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
