const crypto = require("crypto");
const Stripe = require("stripe");

const BUILD = "sn-stripe-webhook-2026-03-20a";
const ALLOWED_ORIGIN = "https://scriptnovaa.com";

const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const KV_REST_API_URL = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
const KV_REST_API_TOKEN = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_test_missing");

const PLAN_DEFS = {
  basic_monthly: {
    planId: "basic_monthly",
    label: "BASIC Monthly",
    plan: "basic",
    tier: "basic_monthly",
    kind: "subscription",
    billingMode: "monthly",
    ttlSeconds: 6 * 60 * 60,
    sessionLimit: 3,
    maxDevices: 2
  },
  basic_yearly: {
    planId: "basic_yearly",
    label: "BASIC Yearly",
    plan: "basic",
    tier: "basic_yearly",
    kind: "subscription",
    billingMode: "yearly",
    ttlSeconds: 6 * 60 * 60,
    sessionLimit: 3,
    maxDevices: 2
  },
  pro_monthly: {
    planId: "pro_monthly",
    label: "PRO Monthly",
    plan: "pro",
    tier: "pro_monthly",
    kind: "subscription",
    billingMode: "monthly",
    ttlSeconds: 30 * 24 * 60 * 60,
    sessionLimit: 6,
    maxDevices: 4
  },
  pro_yearly: {
    planId: "pro_yearly",
    label: "PRO Yearly",
    plan: "pro",
    tier: "pro_yearly",
    kind: "subscription",
    billingMode: "yearly",
    ttlSeconds: 30 * 24 * 60 * 60,
    sessionLimit: 6,
    maxDevices: 4
  },
  elite_monthly: {
    planId: "elite_monthly",
    label: "ELITE Monthly",
    plan: "elite",
    tier: "elite_monthly",
    kind: "subscription",
    billingMode: "monthly",
    ttlSeconds: 90 * 24 * 60 * 60,
    sessionLimit: 10,
    maxDevices: 6
  },
  elite_yearly: {
    planId: "elite_yearly",
    label: "ELITE Yearly",
    plan: "elite",
    tier: "elite_yearly",
    kind: "subscription",
    billingMode: "yearly",
    ttlSeconds: 90 * 24 * 60 * 60,
    sessionLimit: 10,
    maxDevices: 6
  },
  express_one_time: {
    planId: "express_one_time",
    label: "EXPRESS One-Time",
    plan: "express",
    tier: "express_one_time",
    kind: "payment",
    billingMode: "one_time",
    ttlSeconds: 5444 * 60 * 60,
    sessionLimit: 725,
    maxDevices: 2
  },
  black_express_one_time: {
    planId: "black_express_one_time",
    label: "BLACK EXPRESS One-Time",
    plan: "black_express",
    tier: "black_express_one_time",
    kind: "payment",
    billingMode: "one_time",
    ttlSeconds: 12000 * 60 * 60,
    sessionLimit: 1500,
    maxDevices: 12
  }
};

const PRICE_TO_PLAN = {
  price_1TCsni9sB3aXUCNwFEbPx7xq: "basic_monthly",
  price_1TCsoR9sB3aXUCNwJxuvYVkc: "basic_yearly",
  price_1TCspL9sB3aXUCNwvQz851Bo: "pro_monthly",
  price_1TCsqZ9sB3aXUCNwmbWjGdaM: "pro_yearly",
  price_1TCsrJ9sB3aXUCNwrKLkzWAt: "elite_monthly",
  price_1TCss39sB3aXUCNwhXpf1vdL: "elite_yearly",
  price_1TCsuK9sB3aXUCNwhbgKorRG: "express_one_time",
  price_1TCsvP9sB3aXUCNwrcbQWTc4: "black_express_one_time"
};

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req, res, status, body) {
  applyCors(req, res);
  res.status(status).json(body);
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");

  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sanitizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function makeLicensePrefix(planId) {
  const s = String(planId || "").trim().toUpperCase();
  if (s.indexOf("BLACK_EXPRESS") === 0) return "BLACKEXP";
  if (s.indexOf("EXPRESS") === 0) return "EXPRESS";
  if (s.indexOf("ELITE") === 0) return "ELITE";
  if (s.indexOf("PRO") === 0) return "PRO";
  if (s.indexOf("BASIC") === 0) return "BASIC";
  return "SCRIPTNOVA";
}

function randomPart(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len).toUpperCase();
}

function generateLicense(planId) {
  const prefix = makeLicensePrefix(planId);
  return `${prefix}-${randomPart(6)}-${randomPart(6)}-${randomPart(6)}`;
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

function keyPurchaseById(purchaseId) {
  return `sn:stripe:purchase:id:${String(purchaseId || "")}`;
}

function keyWebhookEvent(eventId) {
  return `sn:stripe:webhook:event:${String(eventId || "")}`;
}

function customKeyRedisKey(license) {
  return `sn:custom:${String(license || "")}`;
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

async function kvSetJson(key, value) {
  return await kvCommand(["SET", key, JSON.stringify(value)]);
}

function planFromMetadata(metadata) {
  const direct = String((metadata && metadata.planId) || "").trim();
  if (PLAN_DEFS[direct]) return PLAN_DEFS[direct];
  return null;
}

async function planFromSession(session) {
  const metaPlan = planFromMetadata(session && session.metadata);
  if (metaPlan) return metaPlan;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
    for (const item of (lineItems && lineItems.data) || []) {
      const priceId = String(item && item.price && item.price.id || "").trim();
      const mapped = PRICE_TO_PLAN[priceId];
      if (mapped && PLAN_DEFS[mapped]) {
        return PLAN_DEFS[mapped];
      }
    }
  } catch {}

  return null;
}

function buildCustomKeyRecord(license, plan, checkoutSession, purchaseId) {
  const createdAt = nowSec();
  const exp = createdAt + plan.ttlSeconds;
  const customerEmail = sanitizeEmail(checkoutSession.customer_details && checkoutSession.customer_details.email || checkoutSession.customer_email || "");

  return {
    license,
    plan: plan.plan,
    tier: plan.tier,
    ttlSeconds: plan.ttlSeconds,
    sessionLimit: plan.sessionLimit,
    maxDevices: plan.maxDevices,
    exp,
    note: `Stripe ${plan.label} purchase (${checkoutSession.id})`,
    createdAt,
    createdBy: "stripe_webhook",
    stripe: {
      purchaseId: String(purchaseId || ""),
      checkoutSessionId: String(checkoutSession.id || ""),
      customerId: String(checkoutSession.customer || ""),
      customerEmail,
      subscriptionId: String(checkoutSession.subscription || ""),
      paymentIntentId: String(checkoutSession.payment_intent || ""),
      mode: String(checkoutSession.mode || ""),
      amountTotal: Number(checkoutSession.amount_total || 0),
      currency: String(checkoutSession.currency || "").toUpperCase(),
      livemode: !!checkoutSession.livemode
    }
  };
}

function buildPurchaseRecord({ session, plan, license, purchaseId, orderRef, customKeyRecord, eventId }) {
  const customerEmail = sanitizeEmail(session.customer_details && session.customer_details.email || session.customer_email || "");
  return {
    ok: true,
    fulfilled: true,
    status: "fulfilled",
    eventId: String(eventId || ""),
    purchaseId: String(purchaseId || ""),
    orderRef: String(orderRef || ""),
    checkoutSessionId: String(session.id || ""),
    livemode: !!session.livemode,
    paymentStatus: String(session.payment_status || ""),
    mode: String(session.mode || ""),
    customerEmail,
    customerId: String(session.customer || ""),
    planId: plan.planId,
    planLabel: plan.label,
    plan: plan.plan,
    tier: plan.tier,
    billingMode: plan.billingMode,
    limits: {
      ttlSeconds: customKeyRecord.ttlSeconds,
      sessionLimit: customKeyRecord.sessionLimit,
      maxDevices: customKeyRecord.maxDevices,
      exp: customKeyRecord.exp
    },
    deliveredKey: license,
    key: {
      license,
      plan: customKeyRecord.plan,
      tier: customKeyRecord.tier,
      ttlSeconds: customKeyRecord.ttlSeconds,
      sessionLimit: customKeyRecord.sessionLimit,
      maxDevices: customKeyRecord.maxDevices,
      exp: customKeyRecord.exp,
      note: customKeyRecord.note
    },
    stripe: {
      subscriptionId: String(session.subscription || ""),
      paymentIntentId: String(session.payment_intent || ""),
      amountTotal: Number(session.amount_total || 0),
      currency: String(session.currency || "").toUpperCase()
    },
    createdAt: nowSec(),
    build: BUILD
  };
}

async function fulfillCheckoutSession(eventId, session) {
  if (!session || !session.id) {
    throw new Error("missing_checkout_session");
  }

  const metadata = session.metadata || {};
  const purchaseId = String(metadata.purchaseId || session.client_reference_id || "").trim();
  const orderRef = String(metadata.orderRef || "").trim();

  const existing = await kvGetJson(keyPurchaseBySession(session.id));
  if (existing && existing.fulfilled && existing.deliveredKey) {
    return {
      alreadyFulfilled: true,
      purchase: existing
    };
  }

  const plan = await planFromSession(session);
  if (!plan) {
    throw new Error("unknown_plan_for_checkout_session");
  }

  let license = existing && existing.deliveredKey ? String(existing.deliveredKey) : "";
  if (!license) {
    license = generateLicense(plan.planId);
  }

  const customKeyRecord = buildCustomKeyRecord(license, plan, session, purchaseId);
  const purchaseRecord = buildPurchaseRecord({
    session,
    plan,
    license,
    purchaseId,
    orderRef,
    customKeyRecord,
    eventId
  });

  await kvSetJson(customKeyRedisKey(license), customKeyRecord);
  await kvSetJson(keyPurchaseBySession(session.id), purchaseRecord);

  if (purchaseId) {
    await kvSetJson(keyPurchaseById(purchaseId), purchaseRecord);
  }

  return {
    alreadyFulfilled: false,
    purchase: purchaseRecord
  };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendJson(req, res, 405, {
      ok: false,
      error: "method_not_allowed",
      build: BUILD
    });
  }

  if (!STRIPE_SECRET_KEY) {
    return sendJson(req, res, 500, {
      ok: false,
      error: "missing_stripe_secret_key",
      build: BUILD
    });
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    return sendJson(req, res, 500, {
      ok: false,
      error: "missing_stripe_webhook_secret",
      build: BUILD
    });
  }

  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    return sendJson(req, res, 500, {
      ok: false,
      error: "kv_not_configured",
      build: BUILD
    });
  }

  try {
    const rawBody = await readRawBody(req);
    const stripeSignature = String(req.headers["stripe-signature"] || "").trim();

    if (!stripeSignature) {
      return sendJson(req, res, 400, {
        ok: false,
        error: "missing_stripe_signature",
        build: BUILD
      });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, stripeSignature, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return sendJson(req, res, 400, {
        ok: false,
        error: "invalid_webhook_signature",
        message: err && err.message ? String(err.message) : "signature_verification_failed",
        build: BUILD
      });
    }

    const existingEvent = await kvGetJson(keyWebhookEvent(event.id));
    if (existingEvent && existingEvent.processed) {
      return sendJson(req, res, 200, {
        ok: true,
        duplicate: true,
        eventId: event.id,
        type: event.type,
        build: BUILD
      });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data && event.data.object ? event.data.object : null;
      const result = await fulfillCheckoutSession(event.id, session);

      await kvSetJson(keyWebhookEvent(event.id), {
        processed: true,
        eventId: event.id,
        type: event.type,
        checkoutSessionId: String(session && session.id || ""),
        purchaseId: String(session && session.metadata && session.metadata.purchaseId || session && session.client_reference_id || ""),
        alreadyFulfilled: !!result.alreadyFulfilled,
        processedAt: nowSec(),
        build: BUILD
      });

      return sendJson(req, res, 200, {
        ok: true,
        received: true,
        type: event.type,
        eventId: event.id,
        checkoutSessionId: String(session && session.id || ""),
        purchaseId: String(result.purchase && result.purchase.purchaseId || ""),
        alreadyFulfilled: !!result.alreadyFulfilled,
        build: BUILD
      });
    }

    await kvSetJson(keyWebhookEvent(event.id), {
      processed: true,
      ignored: true,
      eventId: event.id,
      type: event.type,
      processedAt: nowSec(),
      build: BUILD
    });

    return sendJson(req, res, 200, {
      ok: true,
      received: true,
      ignored: true,
      type: event.type,
      eventId: event.id,
      build: BUILD
    });
  } catch (err) {
    return sendJson(req, res, 500, {
      ok: false,
      error: "stripe_webhook_failed",
      message: err && err.message ? String(err.message) : "unknown_webhook_error",
      build: BUILD
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};