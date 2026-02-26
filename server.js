const express = require("express");
const path = require("path");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;

// ====== HOME ======
app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

// ====== PAYMENT PAGE ======
app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = req.params.orderId.replace(/\D/g, "");
  const amount = Number(req.params.amount);

  if (!orderId || !amount) {
    return res.status(400).send("Invalid parameters");
  }

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>תשלום להזמנה ${orderId}</title>

<style>
body{
  font-family:Arial,Helvetica,sans-serif;
  background:linear-gradient(180deg,#f5f5f5,#e9e9e9);
  margin:0;
  padding:20px;
}

.card{
  max-width:520px;
  margin:50px auto;
  background:#ffffff;
  border-radius:20px;
  padding:28px;
  box-shadow:0 15px 40px rgba(0,0,0,.12);
}

.logo{
  text-align:center;
  margin-bottom:25px;
}

.logo img{
  max-width:280px;
  height:auto;
}

h1{
  text-align:center;
  margin:0 0 25px;
  font-size:22px;
  color:#222;
}

label{
  display:block;
  margin:14px 0 6px;
  font-weight:700;
  color:#333;
}

input{
  width:100%;
  padding:13px;
  border:1px solid #ddd;
  border-radius:12px;
  font-size:16px;
  direction:rtl;
  text-align:right;
  box-sizing:border-box;
}

input:focus{
  border-color:#c40000;
  outline:none;
  box-shadow:0 0 0 2px rgba(196,0,0,0.15);
}

button{
  width:100%;
  margin-top:20px;
  padding:15px;
  border:0;
  border-radius:14px;
  font-size:18px;
  font-weight:800;
  cursor:pointer;
  background:#c40000;
  color:#fff;
  transition:0.2s;
}

button:hover{
  background:#a00000;
}

.footer-note{
  text-align:center;
  margin-top:12px;
  font-size:13px;
  color:#777;
}
</style>
</head>

<body>

<div class="card">

<div class="logo">
  <img src="/logo.jpeg" alt="הטאבון">
</div>

<h1>תשלום להזמנה #${orderId}</h1>

<form method="POST" action="/create-session">

<input type="hidden" name="orderId" value="${orderId}" />

<label>סכום לתשלום (₪)</label>
<input name="amount" value="${amount}" required />

<label>שם מלא</label>
<input name="name" required />

<label>טלפון</label>
<input name="phone" required />

<label>אימייל</label>
<input type="email" name="email" required />

<button type="submit">המשך לתשלום</button>

</form>

<div class="footer-note">
התשלום מתבצע באמצעות מערכת מאובטחת של Z-Credit
</div>

</div>
</body>
</html>
`;

  res.send(html);
});

// ====== CREATE SESSION ======
app.post("/create-session", async (req, res) => {
  const { orderId, amount, name, phone, email } = req.body;

  const uniqueId = "order-" + orderId + "-" + Date.now();

  const payload = {
    Key: ZC_KEY,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: BASE_URL + "/payment-success?orderId=" + orderId,
    CancelUrl: BASE_URL + "/payment-cancel?orderId=" + orderId,
    Currency: "ILS",
    Total: Number(amount),
    AdjustAmount: true,
    ShowCart: false,
    AdditionalText: orderId,
    Customer: {
      Email: email,
      Name: name,
      PhoneNumber: phone,
    },
    CartItems: [
      {
        Description: "תשלום להזמנה " + orderId,
        Quantity: 1,
        UnitPrice: Number(amount),
        Amount: Number(amount),
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
    return res.redirect(data.Data.SessionUrl);
  }

  res.send(data);
});

// ====== CALLBACK ======
app.all("/zc-callback", (req, res) => {
  console.log("ZC CALLBACK:", req.body);
  res.send("OK");
});

// ====== SUCCESS ======
app.get("/payment-success", (req, res) => {
  res.send("Payment Success ✅ Order: " + req.query.orderId);
});

// ====== CANCEL ======
app.get("/payment-cancel", (req, res) => {
  res.send("Payment Cancel ❌");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
