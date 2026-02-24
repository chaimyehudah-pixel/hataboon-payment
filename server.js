const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// חובה: משתני סביבה ב-Railway
const ZC_TERMINAL = process.env.ZC_TERMINAL || "";
const ZC_PASSWORD = process.env.ZC_PASSWORD || "";
const ZC_KEY = process.env.ZC_KEY || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, ""); // בלי / בסוף

// חשוב: זו הכתובת שאתה כרגע משתמש בה. אם בדוקס שלהם רשום endpoint אחר ל-WEBCHECKOUT,
// תחליף פה רק את ה-URL.
const ZC_REQUEST_TOKEN_URL = "https://pci.zcredit.co.il/WebControl/RequestToken.aspx";

// ---- עזרה: יצירת חתימה ----
// ⚠️ פה יש סיכוי גדול שהנוסחה/סדר לא תואם לדוקס שלך.
// כרגע שמתי משהו "סביר" + קל לשנות (שורה אחת).
function makeSignature({ terminal, password, orderId, amount, successUrl, cancelUrl, notifyUrl, key }) {
  // 🔧 אם בדוקס כתוב סדר אחר / שדות אחרים - תשנה רק את השורה הבאה:
  const str = `${terminal}${password}${orderId}${amount}${successUrl}${cancelUrl}${notifyUrl}${key}`;

  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

app.get("/env-check", (req, res) => {
  res.json({
    ok: true,
    has: {
      ZC_TERMINAL: !!ZC_TERMINAL,
      ZC_PASSWORD: !!ZC_PASSWORD,
      ZC_KEY: !!ZC_KEY,
      BASE_URL: !!BASE_URL,
    },
    baseUrl: BASE_URL || null,
  });
});

app.get("/create-payment", async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "999");
    const amount = String(req.query.amount || "12.00");

    if (!ZC_TERMINAL || !ZC_PASSWORD || !ZC_KEY || !BASE_URL) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars. Check /env-check",
      });
    }

    const successUrl = `${BASE_URL}/payment-success`;
    const cancelUrl = `${BASE_URL}/payment-cancel`;
    const notifyUrl = `${BASE_URL}/zc-callback`;

    const signature = makeSignature({
      terminal: ZC_TERMINAL,
      password: ZC_PASSWORD,
      orderId,
      amount,
      successUrl,
      cancelUrl,
      notifyUrl,
      key: ZC_KEY,
    });

    // RequestToken.aspx לרוב מצפה לטופס (x-www-form-urlencoded)
    const form = new URLSearchParams();
    form.append("TerminalNumber", ZC_TERMINAL);
    form.append("Password", ZC_PASSWORD);
    form.append("OrderId", orderId);
    form.append("Amount", amount);
    form.append("SuccessURL", successUrl);
    form.append("CancelURL", cancelUrl);
    form.append("NotifyURL", notifyUrl);
    form.append("Signature", signature);

    const resp = await axios.post(ZC_REQUEST_TOKEN_URL, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
      validateStatus: () => true, // שלא יזרוק exception על סטטוס לא 200
    });

    return res.status(200).json({
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
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
});

// endpoints שחוזרים אליך מהסליקה
app.get("/payment-success", (req, res) => res.send("Payment Success ✅"));
app.get("/payment-cancel", (req, res) => res.send("Payment Cancelled ❌"));

app.post("/zc-callback", express.urlencoded({ extended: false }), (req, res) => {
  console.log("ZC CALLBACK (form):", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
