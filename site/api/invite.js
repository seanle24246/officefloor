const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function requestBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString());
    } catch {
      return null;
    }
  }
  return null;
}

function header(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function clientIp(req) {
  return header(req, "x-forwarded-for").split(",", 1)[0].trim().slice(0, 64) || "unknown";
}

async function kv(command, ...args) {
  const baseUrl = process.env.KV_REST_API_URL.replace(/\/+$/, "");
  const path = [command, ...args].map((part) => encodeURIComponent(String(part))).join("/");
  const response = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Object.hasOwn(payload, "error")) {
    throw new Error(`KV ${command} → ${response.status} ${payload.error || ""}`.trim());
  }
  return payload.result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const body = requestBody(req);
  if (!body || typeof body.email !== "string") {
    return json(res, 400, { ok: false, error: "invalid_email" });
  }

  const email = body.email.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return json(res, 400, { ok: false, error: "invalid_email" });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.warn("Opening-invite waitlist is missing its KV configuration");
    return json(res, 503, { ok: false, error: "waitlist_unconfigured" });
  }

  try {
    const rateKey = `ratelimit:${clientIp(req)}`;
    const attempts = Number(await kv("incr", rateKey));
    if (!Number.isInteger(attempts)) throw new Error("Invalid rate-limit response");
    await kv("expire", rateKey, RATE_WINDOW_SECONDS);
    if (attempts > RATE_LIMIT) {
      return json(res, 429, { ok: false, error: "rate_limited" });
    }

    const added = Number(await kv("sadd", "waitlist:emails", email));
    if (added !== 0 && added !== 1) throw new Error("Invalid waitlist response");
    await kv(
      "hset",
      `waitlist:${email}`,
      "ts",
      new Date().toISOString(),
      "ref",
      header(req, "referer").slice(0, 500),
      "ua",
      header(req, "user-agent").slice(0, 120),
    );

    return json(res, 200, { ok: true, already: added === 0 });
  } catch (err) {
    console.warn("Opening-invite waitlist store is unavailable:", err && err.message);
    return json(res, 502, { ok: false, error: "store_unavailable" });
  }
}
