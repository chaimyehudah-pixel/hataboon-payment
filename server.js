const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;

const RECEIPT_TERMINAL_NAME = "הטאבון";
const RECEIPT_TERMINAL_NUMBER = "2666131";
const RECEIPT_MERCHANT_NUMBER = "5927439";

const paymentReceipts = new Map();

function htmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label, value) {
  const v = value && String(value).trim() !== "" ? String(value) : "-";
  return `
  <div class="row">
    <div class="label">${htmlEscape(label)}</div>
    <div class="value">${htmlEscape(v)}</div>
  </div>`;
}

function renderReceipt(data) {
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
background:#efefef;
padding:18px;
}

.receipt{
max-width:620px;
margin:auto;
background:white;
border-radius:18px;
padding:20px;
box-shadow:0 10px 30px rgba(0,0,0,.10);
}

.logo{
text-align:center;
margin-bottom:10px;
}

.logo img{
max-width:200px;
}

.title{
text-align:center;
font-size:26px;
font-weight:900;
margin:8px 0;
}

.ok{
text-align:center;
color:#0a7a2f;
font-weight:800;
margin-bottom:14px;
}

.topBox{
background:#fafafa;
border:1px solid #ececec;
border-radius:14px;
padding:10px;
margin-bottom:14px;
}

.topLine{
display:grid;
grid-template-columns:130px 1fr;
gap:10px;
margin:4px 0;
font-weight:700;
}

.rows{
margin-top:6px;
border-top:1px dashed #d8d8d8;
padding-top:6px;
}

.row{
display:grid;
grid-template-columns:170px 1fr;
gap:10px;
padding:6px 0;
border-bottom:1px solid #f2f2f2;
}

.label{
font-weight:800;
color:#444;
}

.value{
color:#111;
}

.amountBox{
margin-top:14px;
background:#fff8f8;
border:1px solid #ffd9d9;
border-radius:14px;
padding:12px;
text-align:center;
}

.amountTitle{
font-size:14px;
color:#555;
margin-bottom:4px;
font-weight:700;
}

.amountValue{
font-size:30px;
font-weight:900;
color:#b00020;
}

.foot{
margin-top:14px;
text-align:center;
color:#666;
font-size:12px;
}

</style>
</head>

<body>

<div class="receipt">

<div class="logo">
<img src="/logo.jpeg">
</div>

<div class="title">אישור תשלום</div>
<div class="ok">התשלום בוצע בהצלחה ✅</div>

<div class="topBox">

<div class="topLine">
<div>שם:</div>
<div>${htmlEscape(data.customerName)}</div>
</div>

<div class="topLine">
<div>טלפון:</div>
<div>${htmlEscape(data.phone)}</div>
</div>

<div class="topLine">
<div>מספר הזמנה:</div>
<div>${htmlEscape(data.orderId)}</div>
</div>

<div class="topLine">
<div>תאריך ושעת העסקה:</div>
<div>${htmlEscape(data.transactionDateTime)}</div>
</div>

</div>

<div class="rows">

${row("שם מסוף", data.terminalName)}
${row("מספר מסוף", data.terminalNumber)}
${row("מספר עסק בחברת האשראי", data.merchantNumber)}
${row("שם כרטיס", data.cardName)}
${row("מספר כרטיס", data.cardNumber)}
${row("מספר שובר", data.voucherNumber)}
${row("סוג עסקה", data.transactionType)}
${row("מספר אישור מנפיק", data.approvalNumber)}
${row("אופן ביצוע העסקה", data.executionMethod)}
${row("סוג אשראי", data.creditType)}
${row("מטבע", data.currency)}

</div>

<div class="amountBox">
<div class="amountTitle">סכום העסקה</div>
<div class="amountValue">${data.amount} ${data.currency}</div>
</div>

<div class="foot">
מסמך זה מהווה אישור תשלום שהופק ממערכת הסליקה.<br>
תודה שבחרתם בהטאבון 🍕
</div>

</div>

</body>
</html>
`;
}

app.post("/zc-callback", (req, res) => {

const body = req.body || {};

const receipt = {

customerName: body.CustomerName || "",
phone: body.PhoneNumber || "",
orderId: body.AdditionalText || "",
transactionDateTime: body.TransactionDateTime || "",
terminalName: RECEIPT_TERMINAL_NAME,
terminalNumber: RECEIPT_TERMINAL_NUMBER,
merchantNumber: RECEIPT_MERCHANT_NUMBER,

cardName: body.CardName || "",
cardNumber: body.CardLast4Digits || "",
voucherNumber: body.VoucherNumber || "",
transactionType: body.TransactionType || "",
approvalNumber: body.ApprovalNumber || "",
executionMethod: body.ExecutionMethod || "",
creditType: body.CreditType || "",
amount: body.Amount || "",
currency: "ש\"ח"

};

paymentReceipts.set(receipt.orderId, receipt);

res.send("OK");

});

app.get("/payment-success", (req,res)=>{

const orderId=req.query.orderId;
const data=paymentReceipts.get(orderId);

if(!data){
return res.send("אין נתוני קבלה");
}

res.send(renderReceipt(data));

});

app.listen(PORT,()=>{
console.log("Server running on port",PORT);
});
