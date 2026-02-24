const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// חובה: משתני סביבה ב-Railway
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;
const ZC_KEY = process.env.ZC_KEY;
const BASE_URL = process.env.BASE_URL;

// נקודת יצירת טוקן של Z-Credit (טסטים)
const ZC_REQUEST_TOKEN_URL = "https://pci.zcredit.co.il/WebControl/RequestToken.aspx";

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

// בונה חתימה (Signature) – לפי סדר שדות קבוע
function buildSignature({ TerminalNumber, Password, OrderId, Amount, SuccessURL, CancelURL, NotifyURL }, key) {
  const raw =
    String(TerminalNumber) +
    String(Password) +
    String(OrderId) +
    String(Amount) +
    String(SuccessURL) +
    String(CancelURL) +
    String(NotifyURL) +
    String(key);

  return sha256Hex(raw);
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

// בדיקת משתני סביבה בקליק (לא חושף סודות)
app.get("/env-check", (req, res) => {
  res.json({
    ok: true,
    has: {
      ZC_TERMINAL: !!ZC_TERMINAL,
      ZC_PASSWORD: !!ZC_PASSWORD,
      ZC_KEY: !!ZC_KEY,
      BASE_URL: !!BASE_URL
    }
  });
});

// יצירת תשלום
// דוגמה: /create-payment?orderId=999&amount=12.00
app.get("/create-payment", async (req, res) => {
  try {
    const orderId = req.query.orderId || "999";
    const amount = req.query.amount || "12.00";

    // בדיקות חובה כדי שלא תשלח בקשה בלי סיסמה (כמו שקורה לך עכשיו)
    if (!ZC_TERMINAL || !ZC_PASSWORD || !ZC_KEY || !BASE_URL) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars",
        need: ["ZC_TERMINAL", "ZC_PASSWORD", "ZC_KEY", "BASE_URL"],
        has: {
          ZC_TERMINAL: !!ZC_TERMINAL,
          ZC_PASSWORD: !!ZC_PASSWORD,
          ZC_KEY: !!ZC_KEY,
          BASE_URL: !!BASE_URL
        }
      });
    }

    const payload = {
      TerminalNumber: ZC_TERMINAL,
      Password: ZC_PASSWORD,
      OrderId: String(orderId),
      Amount: String(amount),
      SuccessURL: `${BASE_URL}/payment-success`,
      CancelURL: `${BASE_URL}/payment-cancel`,
      NotifyURL: `${BASE_URL}/zc-callback`
    };

    payload.Signature = buildSignature(payload, ZC_KEY);

    // חשוב: הרבה שירותי .aspx מצפים ל-form-urlencoded, לא JSON
    const form = new URLSearchParams(payload);

    const zcResp = await axios.post(ZC_REQUEST_TOKEN_URL, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000
    });

    res.json({
      ok: true,
      sent: {
        TerminalNumber: payload.TerminalNumber,
        Password: "[hidden]",
        OrderId: payload.OrderId,
        Amount: payload.Amount,
        SuccessURL: payload.SuccessURL,
        CancelURL: payload.CancelURL,
        NotifyURL: payload.NotifyURL,
        Signature: payload.Signature
      },
      received: typeof zcResp.data === "string" ? zcResp.data : zcResp.data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

app.post("/zc-callback", express.urlencoded({ extended: false }), (req, res) => {
  console.log("ZC CALLBACK:", req.body);
  res.sendStatus(200);
});

app.get("/payment-success", (req, res) => res.send("Payment Success ✅"));
app.get("/payment-cancel", (req, res) => res.send("Payment Cancelled ❌"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
