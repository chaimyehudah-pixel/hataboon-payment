const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// חובה לשים ב-Railway Variables:
const TERMINAL = process.env.ZC_TERMINAL;     // 0882016016
const PASSWORD = process.env.ZC_PASSWORD;     // Z0882016016
const KEY = process.env.ZC_KEY;               // c0863a...
const BASE_URL = process.env.BASE_URL;        // https://hataboon-payment-production.up.railway.app

function mustEnv(name, val) {
  if (!val) throw new Error(`Missing ENV var: ${name}`);
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

// יצירת עסקה (בדיקה מהדפדפן)
// לדוגמה:
// https://hataboon-payment-production.up.railway.app/create-payment?orderId=999&amount=12.00
app.get("/create-payment", async (req, res) => {
  try {
    mustEnv("ZC_TERMINAL", TERMINAL);
    mustEnv("ZC_PASSWORD", PASSWORD);
    mustEnv("ZC_KEY", KEY);
    mustEnv("BASE_URL", BASE_URL);

    const orderId = String(req.query.orderId || "999");
    const amount = String(req.query.amount || "12.00");

    const SuccessURL = `${BASE_URL}/payment-success`;
    const CancelURL = `${BASE_URL}/payment-cancel`;
    const NotifyURL = `${BASE_URL}/zc-callback`;

    // חתימה בסיסית (אם Z-Credit דורשים פורמט אחר - נעדכן לפי התיעוד שלהם)
    // כרגע: sha256(orderId + amount + terminal + password + key)
    const Signature = crypto
      .createHash("sha256")
      .update(orderId + amount + TERMINAL + PASSWORD + KEY)
      .digest("hex");

    // שולחים כ-Form (הרבה שירותים כאלה מצפים לזה)
    const form = new URLSearchParams();
    form.append("TerminalNumber", TERMINAL);
    form.append("Password", PASSWORD);
    form.append("Key", KEY); // << חשוב! לא היה אצלך
    form.append("OrderId", orderId);
    form.append("Amount", amount);
    form.append("SuccessURL", SuccessURL);
    form.append("CancelURL", CancelURL);
    form.append("NotifyURL", NotifyURL);
    form.append("Signature", Signature);

    const zcUrl = "https://pci.zcredit.co.il/WebControl/RequestToken.aspx";

    const resp = await axios.post(zcUrl, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000
    });

    // מחזירים גם מה נשלח (בלי להדליף סיסמא/מפתח)
    res.json({
      ok: true,
      sent: {
        TerminalNumber: TERMINAL,
        OrderId: orderId,
        Amount: amount,
        SuccessURL,
        CancelURL,
        NotifyURL,
        Signature
      },
      received: resp.data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      details: err?.response?.data || null
    });
  }
});

// דפי חזרה
app.get("/payment-success", (req, res) => res.send("Payment Success ✅"));
app.get("/payment-cancel", (req, res) => res.send("Payment Cancelled ❌"));

// Callback מ-ZCredit (POST בדרך כלל)
app.post("/zc-callback", (req, res) => {
  console.log("ZC CALLBACK:", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
