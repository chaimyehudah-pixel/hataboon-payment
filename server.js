const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const GOOGLE_SERVICE_ACCOUNT = String(process.env.GOOGLE_SERVICE_ACCOUNT || "").trim();
const GOOGLE_SHEET_ID = String(process.env.GOOGLE_SHEET_ID || "").trim();

const receipts = new Map();

/* ================= HELPERS ================= */

function cleanDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function normalizePhoneLocal(phone) {
  let p = cleanDigits(phone);
  if (p.startsWith("972")) return "0" + p.slice(3);
  return p;
}

function normalizePhone972(phone) {
  let p = cleanDigits(phone);
  if (p.startsWith("0")) return "972" + p.slice(1);
  return p;
}

function getNowIsrael() {
  return new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem"
  });
}

/* ================= GOOGLE ================= */

function getSheets() {
  if (!GOOGLE_SERVICE_ACCOUNT) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT");
  }

  if (!GOOGLE_SHEET_ID) {
    throw new Error("Missing GOOGLE_SHEET_ID");
  }

  const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  creds.private_key = String(creds.private_key || "").replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function saveToSheet(data) {
  const sheets = getSheets();

  // מבנה חדש של גיליון payments:
  // A Token
  // B OrderId
  // C OrderDateTime
  // D CustomerName
  // E Phone
  // F Email
  // G CustomerIdNumber
  // H Amount
  // I ApprovalNumber
  // J PaymentDate
  // K DocumentType
  // L PaymentMethod
  // M Subject
  // N Remarks
  // O LinkedDocumentToken
  // P LinkedDocumentNumber
  // Q Status
  // R DocumentNumber
  // S PublicUrl
  // T AdminUrl
  // U MailSent
  // V Error
  // W CreditLast4
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "payments!A:W",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        String(data.token || ""),
        String(data.orderId || ""),
        String(data.orderDateTime || ""),
        String(data.name || ""),
        String(data.phone || ""),
        String(data.email || ""),
        String(data.customerIdNumber || ""),
        String(data.amount || ""),
        String(data.approval || ""),
        String(data.paymentDate || getNowIsrael()),
        String(data.documentType || "receipt"),
        String(data.paymentMethod || "credit"),
        String(data.subject || ""),
        String(data.remarks || ""),
        String(data.linkedDocumentToken || ""),
        String(data.linkedDocumentNumber || ""),
        String(data.status || "no"),
        String(data.documentNumber || ""),
        String(data.publicUrl || ""),
        String(data.adminUrl || ""),
        String(data.mailSent || ""),
        String(data.error || ""),
        String(data.last4 || "")
      ]]
    }
  });
}

/* ================= ZCREDIT ================= */

async function createSession({ orderId, amount, name, phone, source }) {
  const cleanOrderId = cleanDigits(orderId);
  const amountNumber = Number(String(amount || "").replace(",", "."));
  const customerName = String(name || "").trim();
  const phone972 = normalizePhone972(phone);
  const phoneLocal = normalizePhoneLocal(phone);

  if (!BASE_URL || !ZC_KEY || !ZC_TERMINAL || !ZC_PASSWORD) {
    throw new Error("Missing payment server configuration");
  }

  if (!cleanOrderId) {
    throw new Error("Invalid orderId");
  }

  if (!amountNumber || amountNumber <= 0) {
    throw new Error("Invalid amount");
  }

  if (!customerName) {
    throw new Error("Missing customer name");
  }

  if (!phone972) {
    throw new Error("Missing phone");
  }

  const uniqueId =
    "order-" +
    cleanOrderId +
    "-" +
    Date.now() +
    "-" +
    crypto.randomBytes(8).toString("hex");

  receipts.set(uniqueId, {
    token: uniqueId,
    orderId: cleanOrderId,
    name: customerName,
    phone: phoneLocal,
    amount: amountNumber,
    source: source || "manual_payment_link",
    saved: false
  });

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    CallbackUrl: BASE_URL + "/zc-callback",
    SuccessUrl:
      BASE_URL +
      "/payment-success?orderId=" +
      encodeURIComponent(cleanOrderId),
    CancelUrl:
      BASE_URL +
      "/payment-cancel?orderId=" +
      encodeURIComponent(cleanOrderId),
    Total: amountNumber,
    Currency: "ILS",
    AdditionalText: cleanOrderId,
    ShowCart: false,
    Customer: {
      Name: customerName,
      PhoneNumber: phone972
    },
    CartItems: [
      {
        Description: "תשלום להזמנה " + cleanOrderId,
        Quantity: 1,
        UnitPrice: amountNumber,
        Amount: amountNumber,
        Currency: "ILS"
      }
    ]
  };

  console.log("Creating ZCredit session:", {
    orderId: cleanOrderId,
    amount: amountNumber,
    name: customerName,
    phone: phone972,
    callback: payload.CallBackUrl
  });

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error("ZCredit invalid JSON:", text);
    throw new Error("ZCredit returned invalid JSON");
  }

  console.log("ZCredit response:", JSON.stringify(data));

  const sessionUrl = data?.Data?.SessionUrl || data?.SessionUrl;

  if (!response.ok || !sessionUrl) {
    throw new Error("ZCredit failed: " + JSON.stringify(data));
  }

  return sessionUrl;
}

/* ================= UI ================= */

function payPage({ orderId, amount, phone }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>תשלום להזמנה</title>
<style>
body{font-family:Arial;background:#f4f4f4;text-align:center;padding:30px}
.box{background:white;max-width:460px;margin:auto;padding:25px;border-radius:14px}
input,button{width:100%;box-sizing:border-box;padding:14px;margin:8px 0;font-size:18px}
button{background:#159947;color:white;border:0;border-radius:8px;cursor:pointer;font-weight:bold}
.info{background:#fafafa;border:1px solid #ddd;border-radius:8px;padding:12px;text-align:right;margin-bottom:15px}
.small{font-size:14px;color:#666;margin-top:10px}
</style>
</head>
<body>
<div class="box">
<h2>תשלום להזמנה ${orderId}</h2>

<div class="info">
<div><b>מספר הזמנה:</b> ${orderId}</div>
<div><b>סכום:</b> ₪${amount}</div>
${phone ? `<div><b>טלפון:</b> ${phone}</div>` : ""}
</div>

<form method="POST" action="/create-session">
<input type="hidden" name="orderId" value="${orderId}">
<input type="hidden" name="amount" value="${amount}">
<input type="hidden" name="phone" value="${phone || ""}">
<input type="hidden" name="source" value="manual_payment_link">

<input name="name" placeholder="שם מלא" required autocomplete="name">

<button type="submit">מעבר לתשלום</button>
</form>

<div class="small">אין אפשרות לשנות מספר הזמנה, סכום או טלפון.</div>
</div>
</body>
</html>
`;
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.send("Hataboon payment server is running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    baseUrl: !!BASE_URL,
    zcredit: !!(ZC_KEY && ZC_TERMINAL && ZC_PASSWORD),
    google: !!(GOOGLE_SERVICE_ACCOUNT && GOOGLE_SHEET_ID)
  });
});

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanDigits(req.params.orderId);
  const amount = Number(String(req.params.amount || "").replace(",", "."));

  if (!orderId) return res.status(400).send("מספר הזמנה לא תקין");
  if (!amount || amount <= 0) return res.status(400).send("סכום לא תקין");

  res.send(payPage({ orderId, amount, phone }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanDigits(req.params.orderId);
  const amount = Number(String(req.params.amount || "").replace(",", "."));

  if (!orderId) return res.status(400).send("מספר הזמנה לא תקין");
  if (!amount || amount <= 0) return res.status(400).send("סכום לא תקין");

  res.send(payPage({ orderId, amount, phone: "" }));
});

app.post("/create-session", async (req, res) => {
  try {
    const url = await createSession(req.body);
    res.redirect(url);
  } catch (err) {
    console.error("create-session error:", err.message);
    res.status(500).send("שגיאה ביצירת תשלום: " + err.message);
  }
});

app.post("/create-order-session", async (req, res) => {
  try {
    const url = await createSession({
      ...req.body,
      source: "new_order_system"
    });

    res.json({
      ok: true,
      url,
      sessionUrl: url
    });
  } catch (err) {
    console.error("create-order-session error:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* ================= CALLBACK ================= */

function extractOrderIdFromUniqueId(uniqueId) {
  const match = String(uniqueId || "").match(/^order-(\d+)-/);
  return match ? match[1] : "";
}

function extractLast4(body) {
  const raw =
    body.CardNum ||
    body.CardMask ||
    body.CardNumber ||
    body.Pan ||
    body.PAN ||
    "";

  const d = cleanDigits(raw);
  return d.length >= 4 ? d.slice(-4) : "";
}

function pickFirst(...values) {
  for (const v of values) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function extractEmail(body) {
  return pickFirst(
    body.Email,
    body.email,
    body.CustomerEmail,
    body.CustomerMail,
    body.ClientEmail,
    body.BillingEmail,
    body.PayerEmail,
    body.CardOwnerEmail,
    body.UserEmail
  );
}

function extractCustomerIdNumber(body) {
  return cleanDigits(pickFirst(
    body.CustomerID,
    body.CustomerId,
    body.CustomerIdNumber,
    body.CustomerIdentityNumber,
    body.IdentityNumber,
    body.IDNumber,
    body.IdNumber,
    body.TZ,
    body.Taz,
    body.BusinessNumber,
    body.CompanyId,
    body.VatNumber
  ));
}

async function processCallback(body) {
  try {
    console.log("ZCredit callback body:", JSON.stringify(body || {}, null, 2));
    const uniqueId = String(body.UniqueID || body.UniqueId || body.UID || "").trim();
    const approval = String(body.ApprovalNumber || "").trim();

    if (!approval) {
      console.log("callback ignored: no approval number");
      return;
    }

    const rec = receipts.get(uniqueId) || {};

    if (rec.saved) {
      console.log("callback duplicate ignored:", uniqueId);
      return;
    }

    const paymentData = {
      token: uniqueId,
      orderId:
        rec.orderId ||
        cleanDigits(body.AdditionalText) ||
        extractOrderIdFromUniqueId(uniqueId) ||
        cleanDigits(body.ReferenceNumber),
      name: rec.name || String(body.CustomerName || "").trim(),
      phone: rec.phone || normalizePhoneLocal(body.CustomerPhone || body.Phone || ""),
      amount: rec.amount || body.Total || "",
      approval,
      email: extractEmail(body),
      customerIdNumber: extractCustomerIdNumber(body),
      paymentDate: getNowIsrael(),
      documentType: "receipt",
      paymentMethod: "credit",
      subject: "",
      remarks: rec.source || "unknown",
      documentNumber: "",
      last4: extractLast4(body),
      source: rec.source || "unknown"
    };

    await saveToSheet(paymentData);

    receipts.set(uniqueId, {
      ...rec,
      saved: true,
      approval
    });

    console.log("saved payment:", paymentData);
  } catch (err) {
    console.error("callback save error:", err.message);
  }
}

app.all("/zc-callback", (req, res) => {
  const body = req.method === "GET" ? req.query : req.body;

  res.status(200).send("OK");

  setImmediate(() => {
    processCallback(body || {});
  });
});

/* ================= SUCCESS ================= */

app.get("/payment-success", (req, res) => {
  const orderId = cleanDigits(req.query.orderId || "");

  res.send(`
<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>התשלום עבר</title></head>
<body style="font-family:Arial;text-align:center;margin-top:80px">
<h1>✅ התשלום עבר בהצלחה</h1>
${orderId ? `<h2>מספר הזמנה: ${orderId}</h2>` : ""}
</body>
</html>
`);
});

app.get("/payment-cancel", (req, res) => {
  const orderId = cleanDigits(req.query.orderId || "");

  res.send(`
<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>התשלום בוטל</title></head>
<body style="font-family:Arial;text-align:center;margin-top:80px">
<h1>❌ התשלום בוטל</h1>
${orderId ? `<h2>מספר הזמנה: ${orderId}</h2>` : ""}
</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log("server running on port", PORT);
});
