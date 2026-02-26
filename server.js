const express = require("express");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;

if (!BASE_URL || !ZC_KEY) {
  console.error("Missing env vars. Please set BASE_URL and ZC_KEY in Railway Variables.");
  process.exit(1);
}

// ====== HOME ======
app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

// ====== PAYMENT PAGE ======
app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = String(req.params.orderId || "").replace(/\D/g, "");
  const amount = Number(req.params.amount);

  if (!orderId || !Number.isFinite(amount) || amount <= 0) {
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
*{ box-sizing:border-box; }

body{
  font-family:Arial,Helvetica,sans-serif;
  background:linear-gradient(180deg,#f5f5f5,#e9e9e9);
  margin:0;
  padding:20px;
}

.card{
  position:relative;
  max-width:520px;
  margin:50px auto;
  background:#ffffff;
  border-radius:20px;
  padding:28px;
  box-shadow:0 15px 40px rgba(0,0,0,.12);
}

/* כפתור שפה אחד - קבוע במקום (לא זז) */
.lang-btn{
  position:absolute;
  top:16px;
  left:16px;               /* תמיד אותו מקום */
  border:1px solid #ddd;
  background:#fff;
  border-radius:12px;
  padding:10px 14px;
  cursor:pointer;
  font-weight:800;
  font-size:14px;
  color:#222;
  min-width:92px;          /* שלא ישנה גודל */
  height:40px;             /* שלא "יקפוץ" */
  display:inline-flex;
  align-items:center;
  justify-content:center;
  line-height:1;
  user-select:none;
}

.lang-btn:hover{
  border-color:#c40000;
  box-shadow:0 0 0 2px rgba(196,0,0,0,0.10);
}

.lang-btn:focus{
  outline:none;
  box-shadow:0 0 0 2px rgba(196,0,0,0,0.10);
}

.logo{
  text-align:center;
  margin:6px 0 18px;
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

.rtl{
  direction:rtl;
  text-align:right;
}

.ltr{
  direction:ltr;
  text-align:left;
}
</style>
</head>

<body class="rtl">

<div class="card">

  <button type="button" class="lang-btn" id="btnLang">English</button>

  <div class="logo">
    <img src="/logo.jpeg" alt="Hataboon Logo">
  </div>

  <h1 id="title"></h1>

  <form method="POST" action="/create-session">
    <input type="hidden" name="orderId" value="${orderId}" />
    <input type="hidden" name="lang" id="langHidden" value="he" />

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

  document.body.classList.toggle("ltr", t.dir === "ltr");
  document.body.classList.toggle("rtl", t.dir !== "ltr");

  document.getElementById("title").textContent = t.title(orderId);
  document.getElementById("lblAmount").textContent = t.amount;
  document.getElementById("lblName").textContent = t.name;
  document.getElementById("lblPhone").textContent = t.phone;
  document.getElementById("lblEmail").textContent = t.email;
  document.getElementById("btnPay").textContent = t.pay;
  document.getElementById("footer").textContent = t.footer;
  document.getElementById("pageTitle").textContent = t.pageTitle(orderId);
  document.getElementById("btnLang").textContent = t.toggleBtn;

  document.getElementById("langHidden").value = code;

  localStorage.setItem("lang", code);
}

function toggleLang(){
  const current = localStorage.getItem("lang") || "he";
  const next = current === "he" ? "en" : "he";
  applyLang(next);
}

document.getElementById("btnLang").addEventListener("click", toggleLang);

applyLang(localStorage.getItem("lang") || "he");
</script>

</body>
</html>
`;

  res.send(html);
});

// ====== CREATE SESSION ======
app.post("/create-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone, email, lang } = req.body;

    const cleanOrderId = String(orderId || "").replace(/\D/g, "");
    const total = Number(amount);

    if (!cleanOrderId || !Number.isFinite(total) || total <= 0) {
      return res.status(400).send("Invalid parameters");
    }

    const language = (lang === "en") ? "en" : "he";

    const uniqueId = "order-" + cleanOrderId + "-" + Date.now();

    const itemDesc =
      language === "en"
        ? "Payment for order " + cleanOrderId
        : "תשלום להזמנה " + cleanOrderId;

    const payload = {
      Key: ZC_KEY,
      UniqueID: uniqueId,
      CallBackUrl: BASE_URL + "/zc-callback",
      SuccessUrl: BASE_URL + "/payment-success?orderId=" + cleanOrderId,
      CancelUrl: BASE_URL + "/payment-cancel?orderId=" + cleanOrderId,
      Currency: "ILS",
      Total: total,
      AdjustAmount: true,
      ShowCart: false,
      AdditionalText: cleanOrderId,
      Customer: {
        Email: email,
        Name: name,
        PhoneNumber: phone,
      },
      CartItems: [
        {
          Description: itemDesc,
          Quantity: 1,
          UnitPrice: total,
          Amount: total,
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

    res.status(400).send(data);
  } catch (err) {
    console.error("create-session error:", err);
    res.status(500).send("Server error");
  }
});

// ====== CALLBACK ======
app.all("/zc-callback", (req, res) => {
  console.log("ZC CALLBACK BODY:", req.body);
  res.send("OK");
});

// ====== SUCCESS ======
app.get("/payment-success", (req, res) => {
  res.send("Payment Success ✅ Order: " + (req.query.orderId || ""));
});

// ====== CANCEL ======
app.get("/payment-cancel", (req, res) => {
  res.send("Payment Cancel ❌");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
