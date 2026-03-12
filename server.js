const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const MERCHANT_NUMBER = "5927439";

const receiptsByUniqueId = new Map();
const receiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
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
  let d = String(phoneRaw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);
  return d.slice(0, 12);
}

function normalizePhoneLocal(phoneRaw) {
  let d = String(phoneRaw || "").replace(/[^\d]/g, "");
  if (d.startsWith("972")) return "0" + d.slice(3, 12);
  if (d.startsWith("00972")) return "0" + d.slice(5, 14);
  return d.slice(0, 10);
}

function formatIsraelDateTime(dateValue) {
  const d = new Date(dateValue);
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
  const rec = {
    ...receipt,
    uniqueId: uniqueId || receipt.uniqueId || "",
    orderId: orderId || receipt.orderId || ""
  };

  if (rec.uniqueId) {
    receiptsByUniqueId.set(rec.uniqueId, rec);
  }

  if (rec.orderId) {
    receiptsByOrderId.set(rec.orderId, rec);
  }
}

function getReceipt(uniqueId, orderId) {
  if (uniqueId && receiptsByUniqueId.has(uniqueId)) {
    return receiptsByUniqueId.get(uniqueId);
  }

  if (orderId && receiptsByOrderId.has(orderId)) {
    return receiptsByOrderId.get(orderId);
  }

  return null;
}

function deepGetFirst(source, keys) {
  if (!source || typeof source !== "object") return "";

  const wanted = keys.map((k) => String(k).toLowerCase());
  const queue = [source];

  while (queue.length) {
    const obj = queue.shift();
    if (!obj || typeof obj !== "object") continue;

    for (const [k, v] of Object.entries(obj)) {
      if (wanted.includes(String(k).toLowerCase()) && v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v);
      }
    }

    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        queue.push(v);
      }
    }
  }

  return "";
}

async function createZCreditSession({ orderId, amount, name, phone }) {
  const phone972 = normalizePhoneDigits(phone);
  const phoneLocal = normalizePhoneLocal(phone);

  const uniqueId = "order-" + orderId + "-" + Date.now() + "-" + randomId();

  saveReceipt(uniqueId, orderId, {
    uniqueId,
    orderId,
    customerName: String(name || "").trim(),
    phone: phoneLocal,
    amount: Number(amount)
  });

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: BASE_URL + "/payment-success?orderId=" + encodeURIComponent(orderId) + "&uniqueId=" + encodeURIComponent(uniqueId),
    CancelUrl: BASE_URL + "/payment-cancel?orderId=" + encodeURIComponent(orderId),
    Currency: "ILS",
    Total: Number(amount),
    AdditionalText: orderId,
    Customer: {
      Name: String(name || "").trim(),
      PhoneNumber: phone972
    },
    CartItems: [
      {
        Description: "תשלום להזמנה " + orderId,
        Quantity: 1,
        UnitPrice: Number(amount),
        Amount: Number(amount),
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

function renderPaymentPage({ orderId, amount }) {
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
<input name="phone" required>

<button type="submit">מעבר לתשלום</button>
</form>
</div>
</body>
</html>
`;
}

function renderSuccess({ receipt }) {
  const approval = String(receipt.approval || receipt.approvalNumber || receipt.issuerApprovalNumber || "").trim();
  const merchantNumber = String(receipt.merchantNumber || MERCHANT_NUMBER).trim();
  const transactionDateTime = String(receipt.transactionDateTimeFormatted || "").trim();
  const cardLast4 = String(receipt.cardLast4 || receipt.cardNumberLast4 || "").trim();
  const orderId = String(receipt.orderId || "").trim();
  const customerName = String(receipt.customerName || "").trim();
  const phone = String(receipt.phone || "").trim();

  function row(label, value) {
    if (!value || String(value).trim() === "") return "";
    return `
<div class="row">
<div class="label">${htmlEscape(label)}</div>
<div class="value">${htmlEscape(value)}</div>
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
padding:20px;
margin:0;
}
.card{
max-width:520px;
margin:40px auto;
background:#fff;
border-radius:20px;
padding:30px;
box-shadow:0 10px 30px rgba(0,0,0,.1);
text-align:center;
}
.logo img{
max-width:220px;
height:auto;
}
.title{
font-size:32px;
font-weight:900;
margin:10px 0 8px;
}
.ok{
font-size:22px;
color:#1a7f37;
margin-bottom:22px;
font-weight:800;
}
.rows{
margin-top:18px;
text-align:right;
}
.row{
display:flex;
justify-content:space-between;
gap:12px;
border-bottom:1px solid #eee;
padding:12px 0;
}
.label{
font-weight:800;
color:#333;
}
.value{
color:#111;
text-align:left;
direction:ltr;
}
.value.rtl{
direction:rtl;
text-align:left;
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

<div class="rows">
${row("שם המשלם", customerName)}
${row("מספר הזמנה", orderId)}
${row("טלפון", phone)}
${row("מספר עסק בחברת האשראי", merchantNumber)}
${row("תאריך ושעת העסקה", transactionDateTime)}
${row("מספר כרטיס", cardLast4)}
${row("מספר אישור", approval)}
</div>
</div>
</body>
</html>
`;
}

function handleZcCallback(req, res) {
  try {
    const body = req.body || {};

    console.log("ZC CALLBACK");
    console.log(JSON.stringify(body, null, 2));

    const uniqueId = deepGetFirst(body, ["UniqueID", "UniqueId", "Uid", "uid"]);
    const orderId = cleanOrderId(deepGetFirst(body, ["AdditionalText", "additionalText", "orderId", "OrderId"]));

    const existing = getReceipt(uniqueId, orderId) || {};

    const cardRaw = deepGetFirst(body, [
      "CardNumber",
      "cardNumber",
      "CardMask",
      "cardMask",
      "Pan",
      "pan",
      "MaskedPan",
      "maskedPan"
    ]);

    const cardLast4 = String(cardRaw || "").replace(/\D/g, "").slice(-4);

    const callbackDateRaw = deepGetFirst(body, [
      "TransactionDateTime",
      "transactionDateTime",
      "Date",
      "date",
      "TransactionTime",
      "transactionTime"
    ]);

    const callbackDate = callbackDateRaw ? new Date(callbackDateRaw) : new Date();

    const receipt = {
      ...existing,
      uniqueId: uniqueId || existing.uniqueId || "",
      orderId: orderId || existing.orderId || "",
      customerName:
        deepGetFirst(body, ["CustomerName", "customerName", "Name", "name"]) ||
        existing.customerName ||
        "",
      phone:
        normalizePhoneLocal(
          deepGetFirst(body, ["PhoneNumber", "phoneNumber", "Phone", "phone"])
        ) ||
        existing.phone ||
        "",
      merchantNumber:
        deepGetFirst(body, ["MerchantNumber", "merchantNumber", "MerchantId", "merchantId", "BusinessNumber"]) ||
        existing.merchantNumber ||
        MERCHANT_NUMBER,
      transactionDateTimeFormatted:
        formatIsraelDateTime(callbackDate),
      cardLast4:
        cardLast4 || existing.cardLast4 || "",
      approval:
        deepGetFirst(body, ["ApprovalNumber", "approvalNumber", "IssuerApprovalNumber", "issuerApprovalNumber"]) ||
        existing.approval ||
        "",
      createdAt: Date.now()
    };

    saveReceipt(receipt.uniqueId, receipt.orderId, receipt);
  } catch (err) {
    console.error("zc-callback error:", err);
  }

  res.send("OK");
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  res.send(renderPaymentPage({ orderId, amount }));
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
  const orderId = cleanOrderId(req.query.orderId);
  const uniqueId = String(req.query.uniqueId || "").trim();

  const existing = getReceipt(uniqueId, orderId) || {};

  const receipt = {
    ...existing,
    uniqueId: uniqueId || existing.uniqueId || "",
    orderId: orderId || existing.orderId || "",
    customerName: existing.customerName || "",
    phone: existing.phone || "",
    merchantNumber: existing.merchantNumber || MERCHANT_NUMBER,
    transactionDateTimeFormatted: existing.transactionDateTimeFormatted || "",
    cardLast4: existing.cardLast4 || "",
    approval: existing.approval || ""
  };

  res.send(renderSuccess({ receipt }));
});

app.get("/payment-cancel", (req, res) => {
  res.send("התשלום בוטל");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
