const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ENV
const TERMINAL = process.env.ZC_TERMINAL;     // 0882016016
const PASSWORD = process.env.ZC_PASSWORD;     // Z0882016016
const KEY = process.env.ZC_KEY;              // c086...
const BASE_URL = process.env.BASE_URL;       // https://hataboon-payment-production.up.railway.app

function mustEnv(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

// חתימה (כמו שעבדת עד עכשיו - SHA256 hex)
function createSignature({ TerminalNumber, Password, OrderId, Amount, SuccessURL, CancelURL, NotifyURL }) {
  // אם ב-ZCredit החתימה דורשת סדר אחר – זה המקום היחיד שמשנים בו.
  const raw =
    String(TerminalNumber) +
    String(Password) +
    String(OrderId) +
    String(Amount) +
    String(SuccessURL) +
    String(CancelURL) +
    String(NotifyURL) +
    String(KEY);

  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

// בדיקה מהירה שיש ENV (לא חושף סיסמא/מפתח)
app.get("/env-check", (req, res) => {
  res.json({
    ok: true,
    has: {
      ZC_TERMINAL: !!process.env.ZC_TERMINAL,
      ZC_PASSWORD: !!process.env.ZC_PASSWORD,
      ZC_KEY: !!process.env.ZC_KEY,
      BASE_URL: !!process.env.BASE_URL,
    },
  });
});

// יצירת טוקן תשלום
// אפשר לקרוא כך:
// /create-payment?orderId=999&amount=12.00
app.get("/create-payment", async (req, res) => {
  try {
    mustEnv("ZC_TERMINAL", TERMINAL);
    mustEnv("ZC_PASSWORD", PASSWORD);
    mustEnv("ZC_KEY", KEY);
    mustEnv("BASE_URL", BASE_URL);

    const orderId = String(req.query.orderId || "999");
    const amount = String(req.query.amount || "12.00");

    const payload = {
      TerminalNumber: TERMINAL,
      Password: PASSWORD,
      OrderId: orderId,
      Amount: amount,
      SuccessURL: `${BASE_URL}/payment-success`,
      CancelURL: `${BASE_URL}/payment-cancel`,
      NotifyURL: `${BASE_URL}/zc-callback`,
    };

    const Signature = createSignature(payload);

    // חשוב: ASPX בדרך כלל מצפה ל-form-urlencoded, לא JSON
    const form = new URLSearchParams({
      ...payload,
      Signature,
    });

    const url = "https://pci.zcredit.co.il/webcontrol/RequestToken.aspx";

    const resp = await axios.post(url, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
      validateStatus: () => true, // שלא יזרוק על 4xx/5xx, נחזיר את הטקסט כמו שהוא
    });

    // לא מחזירים Password ללקוח
    const safeSent = { ...payload, Password: "[hidden]", Signature };

    res.json({
      ok: true,
      sent: safeSent,
      received: typeof resp.data === "string" ? resp.data : resp.data,
      status: resp.status,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/payment-success", (req, res) => {
  res.send("Payment Success ✅");
});

app.get("/payment-cancel", (req, res) => {
  res.send("Payment Cancelled ❌");
});

// ZCredit callback (אצלך זה NotifyURL)
app.post("/zc-callback", (req, res) => {
  console.log("ZC callback:", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
