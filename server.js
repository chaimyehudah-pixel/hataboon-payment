const express = require("express")
const crypto = require("crypto")

const app = express()

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static("public"))

const PORT = process.env.PORT || 3000

const BASE_URL = process.env.BASE_URL
const ZC_KEY = process.env.ZC_KEY
const ZC_TERMINAL = process.env.ZC_TERMINAL
const ZC_PASSWORD = process.env.ZC_PASSWORD

const MERCHANT_NUMBER = "5927439"

const receiptsByUniqueId = new Map()
const receiptsByOrderId = new Map()

function cleanOrderId(v){
return String(v||"").replace(/\D/g,"")
}

function htmlEscape(str){
return String(str||"")
.replace(/&/g,"&amp;")
.replace(/</g,"&lt;")
.replace(/>/g,"&gt;")
.replace(/"/g,"&quot;")
}

function randomId(){
return crypto.randomBytes(16).toString("hex")
}

function formatIsraelDateTime(date){

return new Intl.DateTimeFormat("he-IL",{
timeZone:"Asia/Jerusalem",
year:"numeric",
month:"2-digit",
day:"2-digit",
hour:"2-digit",
minute:"2-digit",
second:"2-digit",
hour12:false
}).format(date)

}

function saveReceipt(uniqueId,orderId,receipt){

const rec={
...receipt,
uniqueId,
orderId
}

receiptsByUniqueId.set(uniqueId,rec)
receiptsByOrderId.set(orderId,rec)

}

function getReceipt(uniqueId,orderId){

if(uniqueId&&receiptsByUniqueId.has(uniqueId))
return receiptsByUniqueId.get(uniqueId)

if(orderId&&receiptsByOrderId.has(orderId))
return receiptsByOrderId.get(orderId)

return null

}

async function createZCreditSession({orderId,amount,name,phone}){

const uniqueId="order-"+orderId+"-"+Date.now()+"-"+randomId()

saveReceipt(uniqueId,orderId,{
customerName:name,
phone,
orderId
})

const payload={

Key:ZC_KEY,

TerminalNumber:ZC_TERMINAL,
Password:ZC_PASSWORD,

UniqueID:uniqueId,

CallBackUrl:BASE_URL+"/zc-callback",

SuccessUrl:
BASE_URL+
"/payment-success?orderId="+orderId+
"&uniqueId="+uniqueId,

CancelUrl:
BASE_URL+
"/payment-cancel?orderId="+orderId,

Currency:"ILS",
Total:amount,

AdditionalText:orderId,

Customer:{
Name:name,
PhoneNumber:phone
},

CartItems:[
{
Description:"תשלום להזמנה "+orderId,
Quantity:1,
UnitPrice:amount,
Amount:amount,
Currency:"ILS"
}
]

}

const response=await fetch(
"https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
{
method:"POST",
headers:{ "Content-Type":"application/json"},
body:JSON.stringify(payload)
}
)

const data=await response.json()

if(data?.Data?.SessionUrl)
return data.Data.SessionUrl

throw new Error(JSON.stringify(data))

}

function renderPaymentPage({orderId,amount}){

return `
<html dir="rtl">
<head>
<meta charset="utf-8">
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
`

}

function renderSuccess({receipt}){

return `
<html dir="rtl">
<head>
<meta charset="utf-8">
<style>

body{
font-family:Arial;
background:#f4f4f4;
padding:20px;
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

<h2>אישור תשלום</h2>

<div style="color:green;font-weight:bold">
התשלום עבר בהצלחה ✅
</div>

<div class="row">
<div class="label">שם המשלם</div>
<div>${htmlEscape(receipt.customerName)}</div>
</div>

<div class="row">
<div class="label">מספר הזמנה</div>
<div>${receipt.orderId}</div>
</div>

<div class="row">
<div class="label">טלפון</div>
<div>${receipt.phone}</div>
</div>

<div class="row">
<div class="label">מספר עסק בחברת האשראי</div>
<div>${MERCHANT_NUMBER}</div>
</div>

<div class="row">
<div class="label">תאריך ושעת העסקה</div>
<div>${formatIsraelDateTime(new Date())}</div>
</div>

<div class="row">
<div class="label">מספר כרטיס</div>
<div>${receipt.cardLast4||"-"}</div>
</div>

<div class="row">
<div class="label">מספר אישור</div>
<div>${receipt.approval||"-"}</div>
</div>

</div>

</body>
</html>
`

}

function handleZcCallback(req,res){

try{

const body=req.body||{}

const uniqueId=body.UniqueID
const orderId=cleanOrderId(body.AdditionalText)

const existing=getReceipt(uniqueId,orderId)||{}

const receipt={

...existing,

approval:body.ApprovalNumber,

cardLast4:
body.CardNumber?
body.CardNumber.slice(-4):
"",

transactionDateTime:new Date()

}

saveReceipt(uniqueId,orderId,receipt)

}catch(err){

console.error(err)

}

res.send("OK")

}

app.get("/",(req,res)=>{
res.send("Hataboon Payment Server Running 🍕")
})

app.get("/pay/:orderId/:amount",(req,res)=>{

const orderId=cleanOrderId(req.params.orderId)
const amount=req.params.amount

res.send(renderPaymentPage({orderId,amount}))

})

app.post("/create-session",async(req,res)=>{

try{

const {orderId,amount,name,phone}=req.body

const sessionUrl=await createZCreditSession({

orderId:cleanOrderId(orderId),
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

const receipt=getReceipt(uniqueId,orderId)||{
orderId,
customerName:"",
phone:""
}

res.send(renderSuccess({receipt}))

})

app.get("/payment-cancel",(req,res)=>{
res.send("התשלום בוטל")
})

app.listen(PORT,()=>{
console.log("Server running on port",PORT)
})
