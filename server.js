const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL || "";
const ZC_KEY = process.env.ZC_KEY || "";
const ZC_TERMINAL = process.env.ZC_TERMINAL || "";
const ZC_PASSWORD = process.env.ZC_PASSWORD || "";

function cleanDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function normalizePhone972(phoneRaw) {
  let d = cleanDigits(phoneRaw);
  if (d.startsWith("0")) d = "972" + d.slice(1);
  return d;
}

async function createZCreditSession({ orderId, amount, name, phone }) {
  const uniqueId =
    "order-" +
    orderId +
    "-" +
    Date.now() +
    "-" +
    crypto.randomBytes(8).toString("hex");

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: BASE_URL + "/payment-success?orderId=" + orderId,
    CancelUrl: BASE_URL + "/payment-cancel",
    Total: Number(amount),
    Currency: "ILS",
    Customer: {
      Name: name,
      PhoneNumber: normalizePhone972(phone)
    }
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

  throw new Error("ZCredit failed");
}

/* ========================= */
/* 🔥 דף תשלום – רק שם */
/* ========================= */
function renderPayPage({ orderId, amount, phone }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>תשלום להזמנה</title>
<style>
body{font-family:Arial;background:#f4f4f4;text-align:center;padding:30px}
.box{background:white;max-width:420px;margin:auto;padding:25px;border-radius:14px}
input,button{width:100%;padding:14px;margin:10px 0;font-size:18px}
button{background:#159947;color:white;border:0;border-radius:8px;font-weight:bold}
</style>
</head>
<body>

<div class="box">
<h2>תשלום להזמנה ${orderId}</h2>
<p>סה"כ לתשלום: ₪${amount}</p>

<form method="POST" action="/create-session">
<input type="hidden" name="orderId" value="${orderId}">
<input type="hidden" name="amount" value="${amount}">
<input type="hidden" name="phone" value="${phone}">

<input name="name" placeholder="שם מלא" required>

<button type="submit">מעבר לתשלום</button>
</form>

</div>

</body>
</html>
`;
}

/* ========================= */
/* לינק תשלום */
/* ========================= */
app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const phone = req.params.phone;
  const orderId = req.params.orderId;
  const amount = req.params.amount;

  res.send(renderPayPage({ orderId, amount, phone }));
});

/* ========================= */
/* יצירת תשלום */
/* ========================= */
app.post("/create-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone } = req.body;

    const url = await createZCreditSession({
      orderId,
      amount,
      name,
      phone
    });

    res.redirect(url);
  } catch (err) {
    res.send("שגיאה: " + err.message);
  }
});

/* ========================= */
/* CALLBACK – חשוב */
/* ========================= */
app.post("/zc-callback", (req, res) => {
  res.send("OK"); // 🔥 הכי חשוב - מיד

  console.log("ZC CALLBACK:", req.body);
});

/* ========================= */
app.get("/payment-success", (req, res) => {
  res.send("<h1>התשלום עבר בהצלחה ✅</h1>");
});

app.get("/payment-cancel", (req, res) => {
  res.send("<h1>התשלום בוטל ❌</h1>");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
