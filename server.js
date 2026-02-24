const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ====== ENV ======
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;
const ZC_KEY = process.env.ZC_KEY;
const BASE_URL = process.env.BASE_URL;

// ====== HELPERS ======
function sha256hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function must(value, name) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

// בדיקה מהירה שהמשתנים קיימים (לא חושף ערכים)
app.get("/env-check", (req, res) => {
  res.json({
    ok: true,
    has: {
      ZC_TERMINAL: !!ZC_TERMINAL,
      ZC_PASSWORD: !!ZC_PASSWORD,
      ZC_KEY: !!ZC_KEY,
      BASE_URL: !!BASE_URL,
    },
  });
});

// יצירת תשלום (Token) – חשוב: שולחים FORM ולא JSON
app.get("/create-payment", async (req, res) => {
  try {
    must(ZC_TERMINAL, "ZC_TERMINAL");
    must(ZC_PASSWORD, "ZC_PASSWORD");
    must(ZC_KEY, "ZC_KEY");
    must(BASE_URL, "BASE_URL");

    const orderId = String(req.query.orderId || "999");
    const amount = String(req.query.amount || "12.00"); // לדוגמה: 12.00

    const successUrl = `${BASE_URL}/payment-success`;
    const cancelUrl = `${BASE_URL}/payment-cancel`;
    const notifyUrl = `${BASE_URL}/zc-callback`;

    // לפי הדוקס הנפוץ שלהם: SHA256(TerminalNumber + Password + OrderId + Amount + Key)
    const signature = sha256hex(ZC_TERMINAL + ZC_PASSWORD + orderId + amount + ZC_KEY);

    // FORM DATA (x-www-form-urlencoded)
    const form = new URLSearchParams();
    form.append("TerminalNumber", ZC_TERMINAL);
    form.append("Password", ZC_PASSWORD);
    form.append("OrderId", orderId);
    form.append("Amount", amount);
    form.append("SuccessURL", successUrl);
    form.append("CancelURL", cancelUrl);
    form.append("NotifyURL", notifyUrl);
    form.append("Signature", signature);

    const url = "https://pci.zcredit.co.il/WebControl/RequestToken.aspx";

    const resp = await axios.post(url, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
      validateStatus: () => true,
    });

    // מחזירים גם מה נשלח (בלי סיסמה)
    res.status(200).json({
      ok: true,
      sent: {
        TerminalNumber: ZC_TERMINAL,
        Password: "[hidden]",
        OrderId: orderId,
        Amount: amount,
        SuccessURL: successUrl,
        CancelURL: cancelUrl,
        NotifyURL: notifyUrl,
        Signature: signature,
      },
      status: resp.status,
      received: typeof resp.data === "string" ? resp.data : resp.data,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// נקודות חזרה
app.get("/payment-success", (req, res) => res.send("Payment Success ✅"));
app.get("/payment-cancel", (req, res) => res.send("Payment Cancelled ❌"));

// Callback מ-ZCredit (הם שולחים POST בד״כ)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/zc-callback", (req, res) => {
  console.log("ZC CALLBACK:", req.body || req.query);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
