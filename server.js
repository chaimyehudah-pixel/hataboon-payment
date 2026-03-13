const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const GOOGLE_SERVICE_ACCOUNT = String(process.env.GOOGLE_SERVICE_ACCOUNT || "").trim();
const GOOGLE_SHEET_ID = String(process.env.GOOGLE_SHEET_ID || "").trim();

const SHEET_NAME = "payments";

const receiptsByUniqueId = new Map();
const receiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function cleanPhone(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function htmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function randomId() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizePhoneDigits(phoneRaw) {
  let d = cleanPhone(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);
  return d.slice(0, 12);
}

function normalizePhoneLocal(phoneRaw) {
  let d = cleanPhone(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("972") && d.length >= 12) return "0" + d.slice(3, 12);
  if (d.startsWith("0")) return d.slice(0, 10);
  return d.slice(0, 10);
}

function formatIsraelDateTime(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}

function saveReceipt(uniqueId, orderId, receipt) {
  const finalUniqueId = String(uniqueId || receipt.uniqueId || "").trim();
  const finalOrderId = cleanOrderId(orderId || receipt.orderId || "");

  const rec = {
    ...receipt,
    uniqueId: finalUniqueId,
    orderId: finalOrderId
  };

  if (finalUniqueId) {
    receiptsByUniqueId.set(finalUniqueId, rec);
  }

  if (finalOrderId) {
    receiptsByOrderId.set(finalOrderId, rec);
  }
}

function getReceipt(uniqueId, orderId) {
  const cleanUniqueId = String(uniqueId || "").trim();
  const cleanId = cleanOrderId(orderId || "");

  if (cleanUniqueId && receiptsByUniqueId.has(cleanUniqueId)) {
    return receiptsByUniqueId.get(cleanUniqueId);
  }

  if (cleanId && receiptsByOrderId.has(cleanId)) {
    return receiptsByOrderId.get(cleanId);
  }

  return null;
}

function getGoogleCredentials() {
  if (!GOOGLE_SERVICE_ACCOUNT) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT");
  }

  let credentials;
  try {
    credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  } catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT is not valid JSON");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT missing client_email or private_key");
  }

  return credentials;
}

async function appendPaidPaymentToSheet({ token, orderId, phone, amount, approvalNumber, paymentDate }) {
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) {
    throw new Error("Missing Google Sheets environment variables");
  }

  const credentials = getGoogleCredentials();

  console.log("DEBUG GOOGLE_SERVICE_ACCOUNT length:", GOOGLE_SERVICE_ACCOUNT.length);
  console.log("DEBUG GOOGLE_SHEET_ID length:", GOOGLE_SHEET_ID.length);
  console.log("DEBUG GOOGLE client_email exists:", !!credentials.client_email);
  console.log("DEBUG GOOGLE private_key exists:", !!credentials.private_key);

  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  await auth.authorize();

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        String(token || ""),
        String(orderId || ""),
        String(phone || ""),
        String(amount || ""),
        String(approvalNumber || ""),
        String(paymentDate || ""),
        "no"
      ]]
    }
  });
}

async function createZCreditSession({ orderId, amount, name, phone }) {
  const cleanId = cleanOrderId(orderId);
  const customerName = String(name || "").trim();
  const amountNumber = Number(amount);
  const phone972 = normalizePhoneDigits(phone);
  const phoneLocal = normalizePhoneLocal(phone);

  if (!cleanId) throw new Error("Invalid orderId");
  if (!customerName) throw new Error("Missing name");
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) throw new Error("Invalid amount");
  if (!phone972) throw new Error("Invalid phone");

  const uniqueId = "order-" + cleanId + "-" + Date.now() + "-" + randomId();

  saveReceipt(uniqueId, cleanId, {
    customerName,
    phone: phoneLocal,
    orderId: cleanId,
    amount: amountNumber,
    appendedToSheet: false
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

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (data?.Data?.SessionUrl) {
    return data.Data.SessionUrl;
  }

  throw new Error(JSON.stringify(data));
}

function renderPaymentPage({ orderId, amount, phone }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>תשלום</title>
<style>
body{
font-family:Arial,Helvetica,sans-serif;
background:#f4f4f4;
padding:20px;
margin:0;
}
.card{
max-width:500px;
margin:auto;
background:#fff;
border-radius:20px;
padding:30px;
box-shadow:0 10px 30px rgba(0,0,0,.1);
}
.logo{
text-align:center;
margin-bottom:20px;
}
.logo img{
max-width:200px;
}
button{
width:100%;
padding:14px;
border:0;
border-radius:12px;
background:#c40000;
color:#fff;
font-size:18px;
font-weight:bold;
cursor:pointer;
margin-top:20px;
}
input{
width:100%;
padding:12px;
border-radius:10px;
border:1px solid #ddd;
margin-top:6px;
box-sizing:border-box;
}
label{
font-weight:bold;
margin-top:14px;
display:block;
}
h2{
text-align:center;
margin:0 0 20px;
}
</style>
</head>
<body>
<div class="card">
<div class="logo">
<img src="/logo.jpeg" alt="הטאבון">
</div>

<h2>תשלום להזמנה #${htmlEscape(orderId)}</h2>

<form method="POST" action="/create-session">
<input type="hidden" name="orderId" value="${htmlEscape(orderId)}">

<label>סכום לתשלום</label>
<input name="amount" value="${htmlEscape(amount)}" required>

<label>שם מלא</label>
<input name="name" required>

<label>טלפון</label>
<input name="phone" value="${htmlEscape(phone)}" required>

<button type="submit">מעבר לתשלום</button>
</form>
</div>
</body>
</html>
`;
}

function renderSuccess({ receipt, orderIdFromUrl }) {
  const customerName = String(receipt.customerName || "").trim();
  const effectiveOrderId = cleanOrderId(receipt.orderId || orderIdFromUrl || "");
  const phone = String(receipt.phone || "").trim();

  const amount =
    receipt.amount !== undefined &&
    receipt.amount !== null &&
    String(receipt.amount).trim() !== ""
      ? String(receipt.amount).trim()
      : "";

  const approval = String(receipt.approval || "").trim();
  const transactionDateTime = String(receipt.transactionDateTimeFormatted || "").trim();

  function block(label, value) {
    if (!value || String(value).trim() === "") return "";
    return `
<div class="field-block">
  <div class="field-label">${htmlEscape(label)}</div>
  <div class="field-value">${htmlEscape(value)}</div>
</div>
`;
  }

  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>אישור תשלום</title>
<style>
body{
font-family:Arial,Helvetica,sans-serif;
background:#f4f4f4;
padding:14px;
margin:0;
}
.card{
max-width:500px;
margin:18px auto;
background:#fff;
border-radius:20px;
padding:18px 18px;
box-shadow:0 8px 22px rgba(0,0,0,.08);
text-align:center;
}
.logo{
margin-bottom:6px;
}
.logo img{
max-width:180px;
height:auto;
}
.title{
font-size:24px;
font-weight:900;
margin:4px 0 4px;
}
.ok{
font-size:16px;
color:#1a7f37;
margin-bottom:12px;
font-weight:800;
}
.fields{
margin-top:4px;
}
.field-block{
padding:10px 0 8px;
border-bottom:1px solid #eee;
}
.field-block:last-child{
border-bottom:none;
}
.field-label{
font-size:13px;
font-weight:800;
color:#333;
margin-bottom:4px;
text-align:center;
line-height:1.2;
}
.field-value{
font-size:18px;
font-weight:500;
color:#111;
text-align:center;
direction:rtl;
word-break:break-word;
line-height:1.15;
}
</style>
</head>
<body>
<div class="card">
<div class="logo">
<img src="/logo.jpeg" alt="הטאבון">
</div>

<div class="title">אישור תשלום</div>
<div class="ok">התשלום עבר בהצלחה ✅</div>

<div class="fields">
${block("שם המשלם", customerName)}
${block("מספר הזמנה", effectiveOrderId)}
${block("טלפון", phone)}
${block("סכום העסקה", amount ? amount + " ₪" : "")}
${block("תאריך ושעת העסקה", transactionDateTime)}
${block("מספר אישור", approval)}
</div>
</div>
</body>
</html>
`;
}

async function handleZcCallback(req, res) {
  try {
    const body = req.body || {};

    const uniqueId = String(body.UniqueID || "").trim();
    const orderId = cleanOrderId(body.AdditionalText || "");
    const existing = getReceipt(uniqueId, orderId) || {};

    const paymentDate = formatIsraelDateTime(new Date());

    const receipt = {
      ...existing,
      uniqueId: uniqueId || existing.uniqueId || "",
      orderId: cleanOrderId(orderId || existing.orderId || ""),
      approval: String(body.ApprovalNumber || existing.approval || "").trim(),
      transactionDateTimeFormatted: paymentDate
    };

    saveReceipt(receipt.uniqueId, receipt.orderId, receipt);

    if (!receipt.appendedToSheet) {
      await appendPaidPaymentToSheet({
        token: receipt.uniqueId,
        orderId: receipt.orderId,
        phone: receipt.phone || "",
        amount: receipt.amount || "",
        approvalNumber: receipt.approval || "",
        paymentDate
      });

      receipt.appendedToSheet = true;
      saveReceipt(receipt.uniqueId, receipt.orderId, receipt);
    }
  } catch (err) {
    console.error("zc-callback error:", err);
  }

  res.send("OK");
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  res.send(renderPaymentPage({ orderId, amount, phone }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  res.send(renderPaymentPage({ orderId, amount, phone: "" }));
});

app.post("/create-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone } = req.body;

    const sessionUrl = await createZCreditSession({
      orderId: cleanOrderId(orderId),
      amount: Number(amount),
      name,
      phone
    });

    res.redirect(sessionUrl);
  } catch (err) {
    console.error(err);
    res.send("שגיאה ביצירת תשלום");
  }
});

app.all("/zc-callback", handleZcCallback);

app.get("/payment-success", (req, res) => {
  const orderIdFromUrl = cleanOrderId(req.query.orderId || "");
  const uniqueId = String(req.query.uniqueId || "").trim();

  const existing = getReceipt(uniqueId, orderIdFromUrl) || {};

  const receipt = {
    ...existing,
    uniqueId: uniqueId || existing.uniqueId || "",
    orderId: cleanOrderId(existing.orderId || orderIdFromUrl || ""),
    customerName: String(existing.customerName || "").trim(),
    phone: String(existing.phone || "").trim(),
    amount:
      existing.amount !== undefined && existing.amount !== null
        ? existing.amount
        : "",
    approval: String(existing.approval || "").trim(),
    transactionDateTimeFormatted: String(existing.transactionDateTimeFormatted || "").trim()
  };

  res.send(renderSuccess({ receipt, orderIdFromUrl }));
});

app.get("/payment-cancel", (req, res) => {
  res.send("התשלום בוטל");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
