const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

// Railway PORT
const PORT = process.env.PORT || 3000;

// Z-Credit (מגיעים מ-Railway Variables)
const TERMINAL = process.env.ZC_TERMINAL;
const PASSWORD = process.env.ZC_PASSWORD;

// BASE_URL = הכתובת של השרת שלך בריילווי (למשל: https://hataboon-payment-production.up.railway.app)
const BASE_URL = process.env.BASE_URL;

// KEY (מהמייל של Z-Credit) - מומלץ לשים גם ב-ENV, אבל כרגע שמתי קבוע כדי שיעבוד לך מיד
const KEY =
  process.env.ZC_KEY ||
  "c0863aa14e77ec032effda671797c295d8a2ab154e49242871a197d158fa3f30";

function mustHaveEnv(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

/**
 * יוצר עסקה ב-Z-Credit ומחזיר ללקוח URL לתשלום (redirect)
 * בדיקה מהירה:
 * https://YOUR-RAILWAY-URL/create-payment?amount=12.34&orderId=123
 */
app.get("/create-payment", async (req, res) => {
  try {
    mustHaveEnv("ZC_TERMINAL", TERMINAL);
    mustHaveEnv("ZC_PASSWORD", PASSWORD);
    mustHaveEnv("BASE_URL", BASE_URL);

    const amount = String(req.query.amount || "10.00");
    const orderId = String(req.query.orderId || Date.now());

    // חתימה בסיסית (כמו שעשינו קודם): sha256(terminal + password + orderId + key)
    // שים לב: ב-Z-Credit יכולים לדרוש פורמט אחר, אבל זה כדי שתתקדם ותבדוק מול התיעוד שלהם.
    const signature = crypto
      .createHash("sha256")
      .update(`${TERMINAL}${PASSWORD}${orderId}${KEY}`)
      .digest("hex");

    // כתובות חזרה (RETURN/NOTIFY) – חוזרות לשרת שלך
    const successUrl = `${BASE_URL}/payment-success`;
    const cancelUrl = `${BASE_URL}/payment-cancel`;
    const notifyUrl = `${BASE_URL}/zc-callback`;

    // דוגמה לבקשה. אם אצלך בשירות Z-Credit הפרמטרים שונים,
    // ניישר לפי התיעוד/הלוגים.
    const payload = {
      TerminalNumber: TERMINAL,
      Password: PASSWORD,
      OrderId: orderId,
      Amount: amount,
      SuccessURL: successUrl,
      CancelURL: cancelUrl,
      NotifyURL: notifyUrl,
      Signature: signature,
    };

    // נקודת קצה לדוגמה (תואם למסך שראיתי אצלך בקוד)
    // אם בתיעוד שלהם זה URL אחר — נחליף לפי ה-logs.
    const url = "https://pci.zcredit.co.il/WebControl/RequestToken.aspx";

    const { data } = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    // הרבה פעמים הם מחזירים token / payment url.
    // נחזיר הכל כדי שתראה מה התקבל.
    res.json({
      ok: true,
      sent: payload,
      received: data,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
});

// כתובות חזרה בסיסיות
app.get("/payment-success", (req, res) => {
  res.send("Payment Success ✅");
});

app.get("/payment-cancel", (req, res) => {
  res.send("Payment Cancelled ❌");
});

// callback מהספק (POST)
app.post("/zc-callback", (req, res) => {
  console.log("ZC callback body:", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
