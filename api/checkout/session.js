const Stripe = require("stripe");

const BUILD = "sn-stripe-session-2026-03-20a";
const ALLOWED_ORIGIN = "https://scriptnovaa.com";

const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const KV_REST_API_URL = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
const KV_REST_API_TOKEN = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_test_missing");

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req, res, status, body) {
  applyCors(req, res);
  res.status(status).json(body);
}

function safeJsonParse(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === "object") return v;
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

function keyPurchaseBySession(sessionId) {
  return `sn:stripe:purchase:session:${String(sessionId || "")}`;
}

async function kvCommand(args) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    throw new Error("kv_not_configured");
  }

  const response = await fetch(`${KV_REST_API_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([args])
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`kv_http_${response.status}:${text || "request_failed"}`);
  }

  const payload = safeJsonParse(text, null);
  if (!Array.isArray(payload) || !payload.length) {
    throw new Error("kv_invalid_response");
  }

  const first = payload[0] || {};
  if (first.error) {
    throw new Error(String(first.error));
  }

  return first.result;
}

async function kvGetJson(key) {
  const raw = await kvCommand(["GET", key]);
  if (raw == null) return null;
  return safeJsonParse(raw, null);
}

function sanitizeSessionId(v) {
  return String(v || "").trim();
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return sendJson(req, res, 405, {
      ok: false,
      error: "method_not_allowed",
      build: BUILD
    });
  }

  const sessionId = sanitizeSessionId(req.query && req.query.session_id);
  if (!sessionId) {
    return sendJson(req, res, 400, {
      ok: false,
      error: "missing_session_id",
      build: BUILD
    });
  }

  try {
    if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
      return sendJson(req, res, 500, {
        ok: false,
        error: "kv_not_configured",
        build: BUILD
      });
    }

    const purchase = await kvGetJson(keyPurchaseBySession(sessionId));
    if (purchase && purchase.fulfilled) {
      return sendJson(req, res, 200, {
        ok: true,
        found: true,
        status: purchase.status || "fulfilled",
        fulfilled: true,
        checkoutSessionId: sessionId,
        purchase,
        build: BUILD
      });
    }

    if (!STRIPE_SECRET_KEY) {
      return sendJson(req, res, 404, {
        ok: false,
        found: false,
        status: "pending",
        error: "purchase_not_ready",
        checkoutSessionId: sessionId,
        build: BUILD
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || !session.id) {
      return sendJson(req, res, 404, {
        ok: false,
        found: false,
        status: "not_found",
        error: "unknown_session",
        checkoutSessionId: sessionId,
        build: BUILD
      });
    }

    const paid = String(session.payment_status || "").toLowerCase() === "paid";
    return sendJson(req, res, paid ? 202 : 200, {
      ok: paid,
      found: false,
      status: paid ? "pending_fulfillment" : "waiting_for_payment",
      fulfilled: false,
      checkoutSessionId: sessionId,
      session: {
        id: session.id,
        mode: String(session.mode || ""),
        paymentStatus: String(session.payment_status || ""),
        livemode: !!session.livemode,
        customerEmail: String(session.customer_details && session.customer_details.email || session.customer_email || ""),
        amountTotal: Number(session.amount_total || 0),
        currency: String(session.currency || "").toUpperCase()
      },
      message: paid
        ? "Payment is complete, but the webhook has not written the delivered key yet. Try again in a moment."
        : "Checkout session exists, but payment is not marked paid yet.",
      build: BUILD
    });
  } catch (err) {
    return sendJson(req, res, 500, {
      ok: false,
      error: "checkout_session_lookup_failed",
      message: err && err.message ? String(err.message) : "unknown_lookup_error",
      checkoutSessionId: sessionId,
      build: BUILD
    });
  }
};