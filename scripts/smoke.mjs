import assert from "node:assert/strict";

const base = new URL(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000");
assert.ok(
  ["127.0.0.1", "localhost"].includes(base.hostname),
  "Smoke checks run only against a local app.",
);
const origin = base.origin;
const url = (path) => new URL(path, base);
const json = { "Content-Type": "application/json", Origin: origin };

const home = await fetch(base);
assert.equal(home.status, 200);
assert.ok(
  home.headers
    .get("content-security-policy")
    ?.includes("frame-ancestors 'none'"),
);
const html = await home.text();
assert.ok(html.includes("2,980"));
assert.ok(html.includes("sandbox"));
const css = html.match(/href="([^\"]+\.css[^\"]*)"/);
assert.ok(css, "CSS asset is linked");
assert.equal(
  (await fetch(new URL(css[1].replaceAll("&amp;", "&"), base))).status,
  200,
);
for (const path of ["/guide", "/terms", "/privacy", "/legal", "/icon.svg"])
  assert.equal((await fetch(url(path))).status, 200, path);
assert.equal((await fetch(url("/api/health"))).status, 200);

const created = await fetch(url("/api/rooms"), {
  method: "POST",
  headers: json,
  body: JSON.stringify({ title: "HTTP integration check" }),
});
assert.equal(created.status, 201);
const room = await created.json();
assert.ok(/^[A-Z2-9]{8}$/.test(room.id));
const roomUrl = `/api/rooms/${room.id}`;
assert.equal((await fetch(url(roomUrl + "/export"))).status, 401);
assert.equal(
  (
    await fetch(url(roomUrl + "/action"), {
      method: "POST",
      headers: json,
      body: JSON.stringify({ action: "draw", expectedDrawCount: 0 }),
    })
  ).status,
  401,
);

const joined = await fetch(url(roomUrl + "/join"), {
  method: "POST",
  headers: json,
  body: JSON.stringify({ name: "Guest" }),
});
assert.equal(joined.status, 200);
const cookie = joined.headers.get("set-cookie");
assert.ok(cookie?.includes("HttpOnly"));
assert.ok(cookie.includes("SameSite=lax"));
const cookieHeader = cookie.split(";")[0];
const publicView = await (await fetch(url(roomUrl))).json();
assert.equal(publicView.count, 1);
assert.equal(publicView.players, undefined);
assert.equal(publicView.me, undefined);
const own = await (
  await fetch(url(roomUrl), { headers: { Cookie: cookieHeader } })
).json();
assert.equal(own.me.name, "Guest");
assert.equal(own.me.card.length, 25);
assert.equal(
  (
    await fetch(url(`${roomUrl}?revision=${own.revision}`), {
      headers: { Cookie: cookieHeader },
    })
  ).status,
  304,
);

const hostHeaders = { ...json, Authorization: `Bearer ${room.hostToken}` };
const results = await Promise.all(
  [0, 1].map(() =>
    fetch(url(roomUrl + "/action"), {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify({ action: "draw", expectedDrawCount: 0 }),
    }),
  ),
);
assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
const after = await (
  await fetch(url(roomUrl), { headers: { Cookie: cookieHeader } })
).json();
assert.equal(after.drawn.length, 1);
assert.deepEqual(after.me.card, own.me.card);
const exported = await fetch(url(roomUrl + "/export"), {
  headers: { Authorization: `Bearer ${room.hostToken}` },
});
assert.equal(exported.status, 200);
assert.ok((await exported.text()).includes("Guest"));
assert.equal(
  (
    await fetch(url(roomUrl + "/checkout"), {
      method: "POST",
      headers: hostHeaders,
    })
  ).status,
  503,
);
assert.equal(
  (await fetch(url("/api/stripe/webhook"), { method: "POST", body: "{}" }))
    .status,
  503,
);
console.log(
  "HTTP smoke passed: pages/assets, room creation, private cards, auth, cookies, draw race, CSV, and unconfigured-payment guards.",
);
