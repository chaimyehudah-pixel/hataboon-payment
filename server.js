const express = require("express");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;

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
    direction:rtl;
    text-align:right;
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

      <label>אימייל (לצורך חשבונית בלבד)</label>
      <input type="email" name="email" placeholder="לא חובה" />

      <button class="pay" type="submit">המשך לתשלום</button>
    </form>

    <div class="footer-note">
      התשלום מתבצע באמצעות מערכת מאובטחת של Z-Credit
    </div>

  </div>
</body>
</html>
`;

  res.type("html").send(html);
});

// ====== CREATE SESSION ======
app.post("/create-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone, email } = req.body;

    if (!BASE_URL || !ZC_KEY) {
      return res.status(500).send("Missing BASE_URL or ZC_KEY in Railway.");
    }

    const cleanOrderId = String(orderId || "").replace(/\D/g, "");
    const total = Number(amount);

    if (!cleanOrderId || !Number.isFinite(total) || total <= 0) {
      return res.status(400).send("Invalid form data");
    }

    const uniqueId = "order-" + cleanOrderId + "-" + Date.now();

    // אימייל אופציונלי: אם ריק/לא קיים -> לא שולחים ל-ZCredit בכלל
    const cleanEmail = String(email || "").trim();

    const customer = {
      Name: String(name || ""),
      PhoneNumber: String(phone || ""),
      ...(cleanEmail ? { Email: cleanEmail } : {}),
    };

    const payload = {
      Key: String(ZC_KEY),

      ...(ZC_TERMINAL ? { TerminalNumber: String(ZC_TERMINAL) } : {}),
      ...(ZC_PASSWORD ? { Password: String(ZC_PASSWORD) } : {}),

      UniqueID: uniqueId,
      CallBackUrl: BASE_URL + "/zc-callback",
      SuccessUrl: BASE_URL + "/payment-success?orderId=" + cleanOrderId,
      CancelUrl: BASE_URL + "/payment-cancel?orderId=" + cleanOrderId,

      Currency: "ILS",
      Total: total,
      AdjustAmount: true,
      ShowCart: false,
      AdditionalText: cleanOrderId,

      Customer: customer,

      CartItems: [
        {
          Description: "תשלום להזמנה " + cleanOrderId,
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

    return res.status(400).json(data);
  } catch (err) {
    console.error("create-session error:", err);
    return res.status(500).send("Server error");
  }
});

// ====== CALLBACK ======
app.all("/zc-callback", (req, res) => {
  console.log("========== ZC CALLBACK ==========");
  console.log("Time:", new Date().toISOString());
  console.log("Body:", req.body);
  console.log("================================");
  res.status(200).send("OK");
});

// ====== SUCCESS ======
app.get("/payment-success", (req, res) => {
  res.send("התשלום בוצע בהצלחה ✅ הזמנה: " + (req.query.orderId || ""));
});

// ====== CANCEL ======
app.get("/payment-cancel", (req, res) => {
  res.send("התשלום בוטל ❌");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
