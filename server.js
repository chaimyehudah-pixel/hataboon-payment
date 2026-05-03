const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const GOOGLE_SERVICE_ACCOUNT = String(process.env.GOOGLE_SERVICE_ACCOUNT || "").trim();
const GOOGLE_SHEET_ID = String(process.env.GOOGLE_SHEET_ID || "").trim();
const SHEET_NAME = "payments";

const receipts = new Map();

function cleanDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function cleanOrderId(v) {
  return cleanDigits(v);
}

function normalizePhoneLocal(phoneRaw) {
  let d = cleanDigits(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("972") && d.length >= 12) return "0" + d.slice(3, 12);
  if (d.startsWith("0")) return d.slice(0, 10);
  return d.slice(0, 10);
}

function normalizePhone972(phoneRaw) {
  let d = cleanDigits(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);
  return d;
}

function parseAmount(value) {
  const n = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(n.toFixed(2));
}

function formatDate() {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function getGoogleCredentials() {
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  credentials.private_key = String(credentials.private_key || "").replace(/\\n/g, "\n");
  return credentials;
}

function createSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getGoogleCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function getNextReceiptSerial() {
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) return "";

  const sheets = createSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:K`
  });

  const rows = response.data.values || [];
  let max = 0;

  for (let i = 1; i < rows.length; i++) {
    const n = Number(rows[i]?.[8] || "");
    if (Number.isFinite(n) && n > max) max = n;
  }

  return String(max + 1);
}

async function appendPaidPaymentToSheet({
  token,
  orderId,
  name,
  phone,
  amount,
  approvalNumber,
  paymentDate,
  receiptSerial,
  paymentLast4,
  source
}) {
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) return;

  const sheets = createSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        String(token || ""),
        String(orderId || ""),
        String(name || ""),
        String(phone || ""),
        String(amount || ""),
        String(approvalNumber || ""),
        String(paymentDate || ""),
        "no",
        String(receiptSerial || ""),
        String(paymentLast4 || ""),
        String(source || "")
      ]]
    }
  });
}

function extractLast4(body) {
  const candidates = [
    body.CardMask,
    body.CardNum,
    body.CardNumber,
    body.Pan,
    body.PAN,
    body.CreditCard,
    body.TokenizedCardMask
  ];

  for (const c of candidates) {
    const digits = cleanDigits(c);
    if (digits.length >= 4) return digits.slice(-4);
  }

  return "";
}

async function createZCreditSession({ orderId, amount, name, phone, source }) {
  const cleanId = cleanOrderId(orderId);
  const amountNumber = parseAmount(amount);
  const customerName = String(name || "").trim();
  const phoneLocal = normalizePhoneLocal(phone);
  const phone972 = normalizePhone972(phone);

  if (!cleanId) throw new Error("Invalid orderId");
  if (!amountNumber) throw new Error("Invalid amount");
  if (!customerName) throw new Error("Missing name");
  if (!phone972) throw new Error("Invalid phone");

  if (!BASE_URL || !ZC_KEY || !ZC_TERMINAL || !ZC_PASSWORD) {
    throw new Error("Missing payment server configuration");
  }

  const finalSource = source || "manual_payment_link";
  const uniqueId = "order-" + cleanId + "-" + Date.now() + "-" + crypto.randomBytes(16).toString("hex");

  receipts.set(uniqueId, {
    token: uniqueId,
    orderId: cleanId,
    name: customerName,
    phone: phoneLocal,
    amount: amountNumber,
    source: finalSource,
    appended: false
  });

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl:
      BASE_URL +
      "/payment-success?orderId=" +
      encodeURIComponent(cleanId) +
      "&uniqueId=" +
      encodeURIComponent(uniqueId),
    CancelUrl:
      BASE_URL +
      "/payment-cancel?orderId=" +
      encodeURIComponent(cleanId),
    Currency: "ILS",
    Total: amountNumber,
    AdditionalText: cleanId,
    ShowCart: false,
    Customer: {
      Name: customerName,
      PhoneNumber: phone972
    },
    CartItems: [
      {
        Description: "תשלום להזמנה " + cleanId,
        Quantity: 1,
        UnitPrice: amountNumber,
        Amount: amountNumber,
        Currency: "ILS"
      }
    ]
  };

  const response = await fetch("https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (response.ok && data?.Data?.SessionUrl) {
    return data.Data.SessionUrl;
  }

  throw new Error("ZCredit CreateSession failed: " + JSON.stringify(data));
}

function renderPayPage({ orderId, amount, phone }) {
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
label{display:block;text-align:right;font-weight:bold;margin-top:10px}
</style>
</head>
<body>
<div class="box">
<h1>תשלום להזמנה ${orderId}</h1>
<form method="POST" action="/create-session">
<input type="hidden" name="orderId" value="${orderId}">
<input type="hidden" name="amount" value="${amount}">
<label>שם מלא</label>
<input name="name" required>
<label>טלפון</label>
<input name="phone" value="${phone || ""}" required>
<button type="submit">מעבר לתשלום</button>
</form>
</div>
</body>
</html>
`;
}

app.get("/", (req, res) => {
  res.send("Hataboon payment server is running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId && orderId !== "0") {
    return res.status(400).send("מספר הזמנה לא תקין");
  }

  res.send(renderPayPage({ orderId: orderId || "0", amount, phone }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId && orderId !== "0") {
    return res.status(400).send("מספר הזמנה לא תקין");
  }

  res.send(renderPayPage({ orderId: orderId || "0", amount, phone: "" }));
});

app.post("/create-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone } = req.body;

    const sessionUrl = await createZCreditSession({
      orderId,
      amount,
      name,
      phone,
      source: "manual_payment_link"
    });

    res.redirect(sessionUrl);
  } catch (err) {
    console.error("create-session error:", err.message);
    res.status(500).send("שגיאה ביצירת תשלום: " + err.message);
  }
});

app.post("/create-order-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone } = req.body;

    const sessionUrl = await createZCreditSession({
      orderId,
      amount,
      name,
      phone,
      source: "new_order_system"
    });

    res.json({
      ok: true,
      url: sessionUrl,
      sessionUrl
    });
  } catch (err) {
    console.error("create-order-session error:", err.message);
    res.status(500).json({
      ok: false,
      error: "שגיאה ביצירת תשלום",
      details: err.message
    });
  }
});

async function processZcCallbackInBackground(body) {
  try {
    const uniqueId = String(body.UniqueID || "").trim();
    const approvalNumber = String(body.ApprovalNumber || "").trim();

    if (!approvalNumber) return;

    const receipt = receipts.get(uniqueId) || {
      token: uniqueId,
      orderId: cleanOrderId(body.AdditionalText || body.UniqueID || ""),
      name: String(body.CustomerName || "").trim(),
      phone: normalizePhoneLocal(body.CustomerPhone || body.Phone || ""),
      amount: body.Total || "",
      source: "unknown",
      appended: false
    };

    if (receipt.appended) return;

    const paymentDate = formatDate();
    const paymentLast4 = extractLast4(body);
    const receiptSerial = await getNextReceiptSerial();

    await appendPaidPaymentToSheet({
      token: receipt.token,
      orderId: receipt.orderId,
      name: receipt.name,
      phone: receipt.phone,
      amount: receipt.amount,
      approvalNumber,
      paymentDate,
      receiptSerial,
      paymentLast4,
      source: receipt.source
    });

    receipt.appended = true;
    receipt.approvalNumber = approvalNumber;
    receipt.paymentDate = paymentDate;
    receipt.receiptSerial = receiptSerial;
    receipt.paymentLast4 = paymentLast4;

    receipts.set(uniqueId, receipt);

    console.log("zc-callback processed:", {
      uniqueId,
      orderId: receipt.orderId,
      amount: receipt.amount,
      approvalNumber
    });
  } catch (err) {
    console.error("zc-callback background error:", err.message);
  }
}

function handleZcCallback(req, res) {
  const body = req.body || {};

  res.status(200).send("OK");

  setImmediate(() => {
    processZcCallbackInBackground(body);
  });
}

app.all("/zc-callback", handleZcCallback);

app.get("/payment-success", (req, res) => {
  const orderId = cleanOrderId(req.query.orderId || "");

  res.send(`
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>התשלום עבר</title>
</head>
<body style="font-family:Arial;text-align:center;margin-top:80px">
<h1>✅ התשלום עבר בהצלחה</h1>
<h2>מספר הזמנה: ${orderId}</h2>
</body>
</html>
`);
});

app.get("/payment-cancel", (req, res) => {
  res.send(`
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>התשלום בוטל</title>
</head>
<body style="font-family:Arial;text-align:center;margin-top:80px">
<h1>❌ התשלום בוטל</h1>
</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
