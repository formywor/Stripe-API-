const crypto = require("crypto");
const Stripe = require("stripe");

const BUILD = "sn-stripe-checkout-2026-03-19b";

/*
  Replace these placeholder values with your real Stripe values.
  Do not commit real secrets to public repos.
*/
const STRIPE_SECRET_KEY = "REPLACE_WITH_YOUR_STRIPE_SECRET_KEY";

const PRICE_IDS = {
  basic_monthly: "REPLACE_WITH_STRIPE_PRICE_BASIC_MONTHLY",
  basic_yearly: "REPLACE_WITH_STRIPE_PRICE_BASIC_YEARLY",
  pro_monthly: "REPLACE_WITH_STRIPE_PRICE_PRO_MONTHLY",
  pro_yearly: "REPLACE_WITH_STRIPE_PRICE_PRO_YEARLY",
  elite_monthly: "REPLACE_WITH_STRIPE_PRICE_ELITE_MONTHLY",
  elite_yearly: "REPLACE_WITH_STRIPE_PRICE_ELITE_YEARLY",
  express_one_time: "REPLACE_WITH_STRIPE_PRICE_EXPRESS_ONE_TIME",
  black_express_one_time: "REPLACE_WITH_STRIPE_PRICE_BLACK_EXPRESS_ONE_TIME"
};

const stripe = new Stripe(STRIPE_SECRET_KEY);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://scriptnovaa.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function getJsonBody(req) {
  try {
    if (req.body) {
      if (typeof req.body === "string") return JSON.parse(req.body);
      if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8"));
      if (typeof req.body === "object") return req.body;
    }
  } catch {}

  try {
    const raw = await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
      req.on("error", () => resolve(""));
    });

    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function randomId(prefix) {
  return prefix + "_" + crypto.randomBytes(8).toString("hex");
}

function isSafeEmail(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isAllowedSite(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "scriptnovaa.com" || s === "www.scriptnovaa.com";
}

function getBaseSiteUrl(site) {
  const s = String(site || "").trim().toLowerCase();
  if (s === "www.scriptnovaa.com") return "https://www.scriptnovaa.com";
  return "https://scriptnovaa.com";
}

function getPlanById(planId) {
  const plans = {
    basic_monthly: {
      planKey: "basic_monthly",
      label: "BASIC Monthly",
      kind: "subscription",
      productTier: "basic",
      billingMode: "monthly"
    },
    basic_yearly: {
      planKey: "basic_yearly",
      label: "BASIC Yearly",
      kind: "subscription",
      productTier: "basic",
      billingMode: "yearly"
    },

    pro_monthly: {
      planKey: "pro_monthly",
      label: "PRO Monthly",
      kind: "subscription",
      productTier: "pro",
      billingMode: "monthly"
    },
    pro_yearly: {
      planKey: "pro_yearly",
      label: "PRO Yearly",
      kind: "subscription",
      productTier: "pro",
      billingMode: "yearly"
    },

    elite_monthly: {
      planKey: "elite_monthly",
      label: "ELITE Monthly",
      kind: "subscription",
      productTier: "elite",
      billingMode: "monthly"
    },
    elite_yearly: {
      planKey: "elite_yearly",
      label: "ELITE Yearly",
      kind: "subscription",
      productTier: "elite",
      billingMode: "yearly"
    },

    express_one_time: {
      planKey: "express_one_time",
      label: "EXPRESS One-Time",
      kind: "payment",
      productTier: "express",
      billingMode: "one_time"
    },

    black_express_one_time: {
      planKey: "black_express_one_time",
      label: "BLACK EXPRESS One-Time",
      kind: "payment",
      productTier: "black_express",
      billingMode: "one_time"
    }
  };

  return plans[String(planId || "").trim()] || null;
}

function getPriceIdForPlan(planId) {
  return String(PRICE_IDS[String(planId || "").trim()] || "").trim();
}

function getSuccessUrl(baseSiteUrl) {
  return baseSiteUrl + "/buykeys/success?session_id={CHECKOUT_SESSION_ID}";
}

function getCancelUrl(baseSiteUrl) {
  return baseSiteUrl + "/buykeys?canceled=1";
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      build: BUILD
    });
  }

  if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.indexOf("REPLACE_WITH_") === 0) {
    return res.status(500).json({
      ok: false,
      error: "missing_stripe_secret_key",
      build: BUILD
    });
  }

  const body = await getJsonBody(req);

  const planId = String(body.planId || "").trim();
  const site = String(body.site || "scriptnovaa.com").trim();
  const source = String(body.source || "buykeys_html").trim();
  const email = String(body.email || "").trim();

  if (!planId) {
    return res.status(400).json({
      ok: false,
      error: "missing_plan_id",
      build: BUILD
    });
  }

  if (!isAllowedSite(site)) {
    return res.status(400).json({
      ok: false,
      error: "invalid_site",
      build: BUILD
    });
  }

  const plan = getPlanById(planId);
  if (!plan) {
    return res.status(400).json({
      ok: false,
      error: "invalid_plan",
      build: BUILD
    });
  }

  const priceId = getPriceIdForPlan(plan.planKey);
  if (!priceId || priceId.indexOf("REPLACE_WITH_") === 0) {
    return res.status(500).json({
      ok: false,
      error: "missing_price_id",
      planId: plan.planKey,
      build: BUILD
    });
  }

  const baseSiteUrl = getBaseSiteUrl(site);
  const successUrl = getSuccessUrl(baseSiteUrl);
  const cancelUrl = getCancelUrl(baseSiteUrl);

  const purchaseId = randomId("snpay");
  const orderRef = randomId("snorder");

  const metadata = {
    purchaseId,
    orderRef,
    planId: plan.planKey,
    planTier: plan.productTier,
    planKind: plan.kind,
    billingMode: plan.billingMode,
    source,
    site: baseSiteUrl
  };

  const sessionParams = {
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    mode: plan.kind === "subscription" ? "subscription" : "payment",
    client_reference_id: purchaseId,
    metadata,
    allow_promotion_codes: true
  };

  if (isSafeEmail(email)) {
    sessionParams.customer_email = email;
  }

  if (plan.kind === "subscription") {
    sessionParams.subscription_data = {
      metadata
    };
  } else {
    sessionParams.payment_intent_data = {
      metadata
    };
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      purchaseId,
      orderRef,
      planId: plan.planKey,
      mode: sessionParams.mode,
      billingMode: plan.billingMode,
      build: BUILD
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "stripe_checkout_create_failed",
      message: err && err.message ? String(err.message) : "unknown_stripe_error",
      build: BUILD
    });
  }
};