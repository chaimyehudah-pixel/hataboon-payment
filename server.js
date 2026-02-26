const express = require("express");

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
<title id="pageTitle">תשלום להזמנה ${orderId}</title>

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

/* כפתור שפה אחד */
.topbar{
  display:flex;
  justify-content:flex-end;
  align-items:center;
  margin-bottom:10px;
}

.lang-btn{
  border:1px solid #ddd;
  background:#fff;
  border-radius:12px;
  padding:10px 14px;
  cursor:pointer;
  font-weight:800;
  font-size:14px;
  color:#222;              /* חשוב כדי שיראו טקסט תמיד */
  min-width:92px;          /* שלא יראה כמו ריבוע קטן */
}

.lang-btn:hover{
  border-color:#c40000;
  box-shadow:0 0 0 2px rgba(196,0,0,0,0.10);
}

.logo{
  text-align:center;
  margin-bottom:18px;
}

.logo img{
  max-width:260px;
  height:auto;
}

h1{
  text-align:center;
  margin:0 0 20px;
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
  direction:inherit;
  text-align:inherit;
  box-sizing:border-box;
}

input:focus{
  border-color:#c40000;
  outline:none;
  box-shadow:0 0 0 2px rgba(196,0,0,0,0.15);
}

button.pay{
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

button.pay:hover{
  background:#a00000;
}

.footer-note{
  text-align:center;
  margin-top:12px;
  font-size:13px;
  color:#777;
}

.ltr{
  direction:ltr;
  text-align:left;
}
.rtl{
  direction:rtl;
  text-align:right;
}
</style>
</head>

<body>

<div class="card">

  <div class="topbar">
    <button type="button" class="lang-btn" id="btnLang">English</button>
  </div>

  <div class="logo">
    <img src="/logo.jpeg" alt="Hataboon Logo">
  </div>

  <h1 id="title"></h1>

  <form method="POST" action="/create-session">
    <input type="hidden" name="orderId" value="${orderId}" />

    <label id="lblAmount"></label>
    <input name="amount" value="${amount}" required />

    <label id="lblName"></label>
    <input name="name" required />

    <label id="lblPhone"></label>
    <input name="phone" required />

    <label id="lblEmail"></label>
    <input type="email" name="email" required />

    <button class="pay" type="submit" id="btnPay"></button>
  </form>

  <div class="footer-note" id="footer"></div>

</div>

<script>
const orderId = "${orderId}";

const dict = {
  he: {
    lang: "he",
    dir: "rtl",
    title: (id) => "תשלום להזמנה #" + id,
    amount: "סכום לתשלום (₪)",
    name: "שם מלא",
    phone: "טלפון",
    email: "אימייל",
    pay: "המשך לתשלום",
    footer: "התשלום מתבצע באמצעות מערכת מאובטחת של Z-Credit",
    pageTitle: (id) => "תשלום להזמנה " + id,
    toggleBtn: "English"   // כשהדף בעברית -> הכפתור באנגלית
  },
  en: {
    lang: "en",
    dir: "ltr",
    title: (id) => "Payment for Order #" + id,
    amount: "Amount (₪)",
    name: "Full name",
    phone: "Phone",
    email: "Email",
    pay: "Continue to payment",
    footer: "Payment is processed via Z-Credit secure system",
    pageTitle: (id) => "Payment for Order " + id,
    toggleBtn: "עברית"     // כשהדף באנגלית -> הכפתור בעברית
  }
};

function applyLang(code){
  const t = dict[code] || dict.he;

  document.documentElement.lang = t.lang;
  document.documentElement.dir = t.dir;

  const isLtr = t.dir === "ltr";
  document.body.classList.toggle("ltr", isLtr);
  document.body.classList.toggle("rtl", !isLtr);

  document.getElementById("title").textContent = t.title(orderId);
  document.getElementById("lblAmount").textContent = t.amount;
  document.getElementById("lblName").textContent = t.name;
  document.getElementById("lblPhone").textContent = t.phone;
  document.getElementById("lblEmail").textContent = t.email;
  document.getElementById("btnPay").textContent = t.pay;
  document.getElementById("footer").textContent = t.footer;
  document.getElementById("pageTitle").textContent = t.pageTitle(orderId);

  // כאן הכפתור תמיד מציג את "השפה השניה"
  document.getElementById("btnLang").textContent = t.toggleBtn;

  localStorage.setItem("lang", code);
}

function toggleLang(){
  const current = localStorage.getItem("lang") || "he";
  const next = current === "he" ? "en" : "he";
  applyLang(next);
}

document.getElementById("btnLang").addEventListener("click", toggleLang);

const saved = localStorage.getItem("lang") || "he";
applyLang(saved);
</script>

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
        Description: "Payment for order " + orderId,
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
