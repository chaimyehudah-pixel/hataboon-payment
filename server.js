const express = require("express");

const app = express();
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

// ====== CONFIG ======
const BASE_URL = process.env.BASE_URL || ""; // e.g. https://hataboon-payment-production.up.railway.app
const ZC_KEY = process.env.ZC_KEY || "";
const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK || ""; // optional: Google Apps Script webhook URL

// ====== HELPERS ======
async function postJson(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

function normalizeAmount(amountStr) {
  // allow "43" or "43.00"
  const n = Number(amountStr);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ====== HOME ======
app.get("/", (req, res) => {
  res.type("text").send("Hataboon Payment Server Running 🚀");
});

// ====== 1) PRE-PAY PAGE (prefilled order+amount) ======
// URL format: /pay/200/10   => orderId=200, amount=10
app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = req.params.orderId;
  const amount = normalizeAmount(req.params.amount);

  if (!amount) return res.status(400).type("text").send("Invalid amount");

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>תשלום להזמנה ${escapeHtml(orderId)}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;margin:0;padding:24px}
    .card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:20px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
    h1{margin:0 0 12px;font-size:20px}
    label{display:block;margin:12px 0 6px;font-weight:700}
    input{width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px}
    .row{display:flex;gap:12px}
    .row>div{flex:1}
    .hint{color:#666;font-size:13px;margin-top:8px}
    button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:12px;font-size:18px;font-weight:800;cursor:pointer}
    button{background:#0b5bd3;color:#fff}
    .locked{background:#f2f3f6}
  </style>
</head>
<body>
  <div class="card">
    <h1>תשלום להזמנה #${escapeHtml(orderId)}</h1>

    <form method="POST" action="/create-session">
      <div class="row">
        <div>
          <label>מספר הזמנה</label>
          <input class="locked" name="orderId" value="${escapeHtml(orderId)}" readonly />
        </div>
        <div>
          <label>סכום לתשלום (₪)</label>
          <input class="locked" name="amount" value="${escapeHtml(amount)}" readonly />
        </div>
      </div>

      <label>שם מלא</label>
      <input name="name" placeholder="לדוגמה: חיים יהודה" required />

      <label>טלפון</label>
      <input name="phone" placeholder="05XXXXXXXX" required />

      <label>אימייל</label>
      <input type="email" name="email" placeholder="name@example.com" required />

      <div class="hint">לחיצה על “המשך לתשלום” תעביר אותך לעמוד תשלום מאובטח של Z-Credit.</div>

      <button type="submit">המשך לתשלום</button>
    </form>
  </div>
</body>
</html>
`;
  res.type("html").send(html);
});

// ====== 2) CREATE Z-CREDIT SESSION AND REDIRECT ======
app.post("/create-session", async (req, res) => {
  try {
    if (!ZC_KEY) return res.status(500).type("text").send("Missing ZC_KEY");
    if (!BASE_URL) return res.status(500).type("text").send("Missing BASE_URL");

    const orderId = String(req.body.orderId || "").trim();
    const amount = normalizeAmount(req.body.amount);
    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").trim();
    const email = String(req.body.email || "").trim();

    if (!orderId) return res.status(400).type("text").send("Missing orderId");
    if (!amount) return res.status(400).type("text").send("Invalid amount");

    // IMPORTANT: UniqueID must be unique per order
    const uniqueId = `order-${orderId}`;

    // WebCheckout Create Session (based on what already worked for you)
    const payload = {
      Key: ZC_KEY,
      UniqueID: uniqueId,
      CallBackUrl: `${BASE_URL}/zc-callback`,
      SuccessUrl: `${BASE_URL}/payment-success?orderId=${encodeURIComponent(orderId)}`,
      CancelUrl: `${BASE_URL}/payment-cancel?orderId=${encodeURIComponent(orderId)}`,
      Currency: "ILS",
      Total: amount,
      AdjustAmount: true,
      ShowCart: false,
      // “מידע נוסף” – תלוי בדיוק בשדה שה-API שלהם מצפה לו.
      // פה אנחנו שמים את זה בתוך AdditionalText (אם אצלם זה השם הנכון זה יופיע).
      AdditionalText: `מספר הזמנה: ${orderId}`,
      Customer: {
        Email: email,
        Name: name,
        PhoneNumber: phone,
        Attributes: {
          HolderId: "optional",
          Name: "optional",
          PhoneNumber: "optional",
          Email: "optional",
        },
      },
      CartItems: [
        {
          Description: `הטאבון - תשלום להזמנה ${orderId}`,
          Quantity: 1,
          UnitPrice: amount,
          Amount: amount,
          Currency: "ILS",
        },
      ],
    };

    const { status, json, text } = await postJson(
      "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
      payload
    );

    if (!json) {
      console.log("ZC RAW:", text);
      return res.status(502).type("text").send("Bad response from Z-Credit");
    }

    // If success -> redirect to their SessionUrl
    const sessionUrl = json?.Data?.SessionUrl || json?.SessionUrl;
    const hasError = json?.HasError || json?.Data?.HasError;

    if (status !== 200 || hasError || !sessionUrl) {
      console.log("ZC ERROR:", JSON.stringify(json, null, 2));
      return res.status(400).type("json").send(json);
    }

    // Redirect customer to Z-Credit checkout
    return res.redirect(sessionUrl);
  } catch (e) {
    console.error("create-session failed:", e);
    res.status(500).type("text").send("Server error");
  }
});

// ====== 3) CALLBACK FROM Z-CREDIT (store to Sheets) ======
app.all("/zc-callback", async (req, res) => {
  try {
    console.log("========== ZC CALLBACK ==========");
    console.log("Time:", new Date().toISOString());
    console.log("Method:", req.method);
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Query:", JSON.stringify(req.query, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));
    console.log("=================================");

    // If you have Google Sheets webhook, send it
    if (SHEETS_WEBHOOK) {
      const payload = {
        ts: new Date().toISOString(),
        source: "zcredit-callback",
        headers: req.headers,
        query: req.query,
        body: req.body,
      };
      const r = await postJson(SHEETS_WEBHOOK, payload);
      console.log("Sheets webhook status:", r.status);
    }

    // Always OK (so they don't fail)
    res.type("text").status(200).send("OK");
  } catch (e) {
    console.error("callback failed:", e);
    res.type("text").status(200).send("OK");
  }
});

// ====== 4) SUCCESS / CANCEL PAGES ======
app.get("/payment-success", (req, res) => {
  const orderId = req.query.orderId || "";
  res.type("text").send(`Payment Success ✅\nOrder: ${orderId}`);
});

app.get("/payment-cancel", (req, res) => {
  const orderId = req.query.orderId || "";
  res.type("text").send(`Payment Cancel ❌\nOrder: ${orderId}`);
});

// ====== START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on", PORT));
