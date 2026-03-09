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

const TERMINAL_NAME = "הטאבון";
const TERMINAL_NUMBER = "2666131";
const MERCHANT_NUMBER = "5927439";

const payments = new Map();

function html(s){
return String(s||"")
.replace(/&/g,"&amp;")
.replace(/</g,"&lt;")
.replace(/>/g,"&gt;")
.replace(/"/g,"&quot;");
}

function row(label,val){
return `
<div class="row">
<div class="label">${html(label)}</div>
<div class="value">${html(val||"-")}</div>
</div>`;
}

function receiptPage(data){

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
<div>${html(data.customerName)}</div>
</div>

<div class="topLine">
<div>טלפון:</div>
<div>${html(data.phone)}</div>
</div>

<div class="topLine">
<div>מספר הזמנה:</div>
<div>${html(data.orderId)}</div>
</div>

<div class="topLine">
<div>תאריך ושעת העסקה:</div>
<div>${html(data.date)}</div>
</div>

</div>

<div class="rows">

${row("שם מסוף",TERMINAL_NAME)}
${row("מספר מסוף",TERMINAL_NUMBER)}
${row("מספר עסק בחברת האשראי",MERCHANT_NUMBER)}
${row("שם כרטיס",data.card)}
${row("מספר כרטיס",data.cardNumber)}
${row("מספר שובר",data.voucher)}
${row("סוג עסקה",data.type)}
${row("מספר אישור מנפיק",data.approval)}
${row("אופן ביצוע העסקה",data.method)}
${row("סוג אשראי",data.credit)}
${row("מטבע","ש\"ח")}

</div>

<div class="amountBox">
<div class="amountTitle">סכום העסקה</div>
<div class="amountValue">${data.amount} ש"ח</div>
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

app.get("/",(req,res)=>{
res.send("Hataboon Payment Server Running");
});

app.get("/pay/:orderId/:amount",(req,res)=>{

const orderId=req.params.orderId;
const amount=req.params.amount;

res.send(`
<html dir="rtl">

<body style="font-family:Arial">

<h2>תשלום להזמנה ${orderId}</h2>

<form method="post" action="/create">

<input type="hidden" name="orderId" value="${orderId}">
<input type="hidden" name="amount" value="${amount}">

שם<br>
<input name="name"><br><br>

טלפון<br>
<input name="phone"><br><br>

<button type="submit">מעבר לתשלום</button>

</form>

</body>
</html>
`);

});

app.post("/create",async(req,res)=>{

const {orderId,amount,name,phone}=req.body;

const uniqueId="order-"+orderId+"-"+Date.now();

payments.set(uniqueId,{
customerName:name,
phone:phone,
orderId:orderId,
amount:amount
});

const payload={
Key:ZC_KEY,
TerminalNumber:ZC_TERMINAL,
Password:ZC_PASSWORD,
UniqueID:uniqueId,
SuccessUrl:BASE_URL+"/success?uid="+uniqueId,
CancelUrl:BASE_URL+"/cancel",
CallBackUrl:BASE_URL+"/callback",
Total:amount,
Currency:"ILS",
AdditionalText:orderId
};

const r=await fetch("https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",{
method:"POST",
headers:{'Content-Type':'application/json'},
body:JSON.stringify(payload)
});

const j=await r.json();

if(j?.Data?.SessionUrl){
res.redirect(j.Data.SessionUrl);
}
else{
res.send(JSON.stringify(j));
}

});

app.post("/callback",(req,res)=>{

const b=req.body;

const uid=b.UniqueID;

const p=payments.get(uid)||{};

p.card=b.CardName;
p.cardNumber=b.CardLast4Digits;
p.voucher=b.VoucherNumber;
p.approval=b.ApprovalNumber;
p.type=b.TransactionType;
p.method=b.ExecutionMethod;
p.credit=b.CreditType;
p.date=b.TransactionDateTime;

payments.set(uid,p);

res.send("OK");

});

app.get("/success",(req,res)=>{

const uid=req.query.uid;

const data=payments.get(uid);

if(!data){
res.send("אין נתונים");
return;
}

res.send(receiptPage(data));

});

app.get("/cancel",(req,res)=>{
res.send("התשלום בוטל");
});

app.listen(PORT,()=>{
console.log("Server running on port",PORT);
});
