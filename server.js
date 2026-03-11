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

const RECEIPT_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const paymentReceiptsByUniqueId = new Map();
const paymentReceiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function toAmountNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
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
  return d.slice(0, 10);
}

function saveReceipt(uniqueId, orderId, receipt) {
  const rec = {
    ...receipt,
    uniqueId,
    orderId,
    createdAt: Date.now(),
  };

  paymentReceiptsByUniqueId.set(uniqueId, rec);
  paymentReceiptsByOrderId.set(orderId, rec);
}

function getReceipt(uniqueId, orderId) {
  if (uniqueId && paymentReceiptsByUniqueId.has(uniqueId)) {
    return paymentReceiptsByUniqueId.get(uniqueId);
  }
  if (orderId && paymentReceiptsByOrderId.has(orderId)) {
    return paymentReceiptsByOrderId.get(orderId);
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
      if (wanted.includes(String(k).toLowerCase()) && v) {
        return String(v);
      }
    }

    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") queue.push(v);
    }
  }

  return "";
}

function formatIsraelDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const d = new Date(raw);

  if (Number.isNaN(d.getTime())) return raw;

  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

async function createZCreditSession({ orderId, amount, name, phone }) {

  const phone972 = normalizePhoneDigits(phone);
  const phoneLocal = normalizePhoneLocal(phone);

  const uniqueId = "order-" + orderId + "-" + Date.now() + "-" + randomId();

  saveReceipt(uniqueId, orderId, {
    customerName: name,
    phone: phoneLocal,
    orderId,
    uniqueId,
    amount,
  });

  const payload = {

    Key: ZC_KEY,

    ...(ZC_TERMINAL ? { TerminalNumber: ZC_TERMINAL } : {}),
    ...(ZC_PASSWORD ? { Password: ZC_PASSWORD } : {}),

    UniqueID: uniqueId,

    CallBackUrl: BASE_URL + "/zc-callback",

    SuccessUrl:
      BASE_URL +
      "/payment-success?orderId=" +
      orderId +
      "&uniqueId=" +
      uniqueId,

    CancelUrl:
      BASE_URL +
      "/payment-cancel?orderId=" +
      orderId,

    Currency: "ILS",
    Total: amount,
    AdjustAmount: true,
    ShowCart: false,

    AdditionalText: orderId,

    Customer: {
      Name: name,
      PhoneNumber: phone972,
    },

    CartItems: [
      {
        Description: "תשלום להזמנה " + orderId,
        Quantity: 1,
        UnitPrice: amount,
        Amount: amount,
        Currency: "ILS",
      },
    ],
  };

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>תשלום</title>

<style>

body{
font-family:Arial;
background:#f4f4f4;
padding:20px;
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
}

label{
font-weight:bold;
margin-top:14px;
display:block;
}

</style>
</head>

<body>

<div class="card">

<div class="logo">
<img src="/logo.jpeg">
</div>

<h2>תשלום להזמנה #${orderId}</h2>

<form method="POST" action="/create-session">

<input type="hidden" name="orderId" value="${orderId}">

<label>סכום לתשלום</label>
<input name="amount" value="${amount}" required>

<label>שם מלא</label>
<input name="name" required>

<label>טלפון</label>
<input name="phone" required>

<button>מעבר לתשלום</button>

</form>

</div>

</body>
</html>
`;
}

function renderSuccess({ receipt }) {

const approval = receipt.approvalNumber || receipt.issuerApprovalNumber || "";

return `
<!doctype html>
<html lang="he" dir="rtl">
<head>

<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">

<title>אישור תשלום</title>

<style>

body{
font-family:Arial;
background:#f4f4f4;
padding:20px;
}

.card{
max-width:500px;
margin:auto;
background:#fff;
border-radius:20px;
padding:30px;
box-shadow:0 10px 30px rgba(0,0,0,.1);
text-align:center;
}

.logo img{
max-width:200px;
}

.title{
font-size:32px;
font-weight:bold;
margin:10px 0;
}

.ok{
font-size:22px;
color:#1a7f37;
margin-bottom:20px;
font-weight:bold;
}

.row{
display:flex;
justify-content:space-between;
border-bottom:1px solid #eee;
padding:10px 0;
}

.label{
font-weight:bold;
}

</style>

</head>

<body>

<div class="card">

<div class="logo">
<img src="/logo.jpeg">
</div>

<div class="title">אישור תשלום</div>

<div class="ok">התשלום עבר בהצלחה ✅</div>

<div class="row"><div class="label">שם המשלם</div><div>${htmlEscape(receipt.customerName)}</div></div>
<div class="row"><div class="label">מספר הזמנה</div><div>${htmlEscape(receipt.orderId)}</div></div>
<div class="row"><div class="label">טלפון</div><div>${htmlEscape(receipt.phone)}</div></div>
<div class="row"><div class="label">תאריך ושעה</div><div>${formatIsraelDateTime(receipt.transactionDateTime)}</div></div>

${approval ? `<div class="row"><div class="label">מספר אישור</div><div>${approval}</div></div>` : ""}

</div>

</body>
</html>
`;
}

function handleZcCallback(req, res) {

const body = req.body || {};

const uniqueId = deepGetFirst(body, ["UniqueID","UniqueId"]);
const orderId = cleanOrderId(deepGetFirst(body, ["AdditionalText","orderId"]));

const receipt = getReceipt(uniqueId,orderId) || {};

receipt.transactionDateTime = deepGetFirst(body,["TransactionDateTime","date"]);
receipt.approvalNumber = deepGetFirst(body,["ApprovalNumber","approvalNumber"]);
receipt.issuerApprovalNumber = deepGetFirst(body,["IssuerApprovalNumber"]);

saveReceipt(uniqueId,orderId,receipt);

res.send("OK");
}

app.get("/",(req,res)=>{

res.send("Hataboon Payment Server Running 🍕")

})

app.get("/pay/:orderId/:amount",(req,res)=>{

const orderId=cleanOrderId(req.params.orderId)
const amount=toAmountNumber(req.params.amount)

res.send(renderPaymentPage({orderId,amount}))

})

app.post("/create-session",async(req,res)=>{

try{

const {orderId,amount,name,phone}=req.body

const cleanId=cleanOrderId(orderId)

const sessionUrl=await createZCreditSession({
orderId:cleanId,
amount:Number(amount),
name,
phone
})

res.redirect(sessionUrl)

}catch(err){

console.error(err)

res.send("שגיאה ביצירת תשלום")

}

})

app.all("/zc-callback",handleZcCallback)

app.get("/payment-success",(req,res)=>{

const orderId=cleanOrderId(req.query.orderId)
const uniqueId=req.query.uniqueId

const receipt=getReceipt(uniqueId,orderId)

res.send(renderSuccess({receipt}))

})

app.get("/payment-cancel",(req,res)=>{

res.send("התשלום בוטל")

})

app.listen(PORT,()=>{

console.log("Server running on port",PORT)

})
