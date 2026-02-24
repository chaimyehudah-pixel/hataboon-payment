const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ZC_KEY = process.env.ZC_KEY || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

// זה ה-API הנכון לפי המסמך שלהם (WebCheckout)
const ZC_CREATE_SESSION_URL =
  "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession/";

// דפים אצלך
const SUCCESS_URL = () => `${BASE_URL}/payment-success`;
const CANCEL_URL = () => `${BASE_URL}/payment-cancel`;
const CALLBACK_URL = () => `${BASE_URL}/zc-callback`; // הם קוראים לזה CallBackUrl

function mustEnv(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

// בדיקה שה-ENV קיים (לא חושף ערכים)
app.get("/env-check", (req, res) => {
  res.json({
    ok: true,
    has: {
      ZC_KEY: !!ZC_KEY,
      BASE_URL: !!BASE_URL
    },
    baseUrl: BASE_URL || null
  });
});

/**
 * יוצר Session ב-WebCheckout ומחזיר SessionUrl
 * דוגמה:
 * /create-session?orderId=154&amount=43
 */
app.get("/create-session", async (req, res) => {
  try {
    mustEnv("ZC_KEY", ZC_KEY);
    mustEnv("BASE_URL", BASE_URL);

    const orderId = String(req.query.orderId || "999");
    const amountRaw = req.query.amount || "12";
    const amount = Number(amountRaw);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // כדי לאפשר ללקוח לשנות סכום (טיפ/פיצול) – משתמשים ב-AdjustAmount=true
    // חשוב: בדוקס כתוב שזה מותר רק עם פריט אחד בעגלה.
    const payload = {
      Key: ZC_KEY,

      // מזהה שלך (כדי שתחבר לתשלום של הזמנה)
      UniqueID: `order-${orderId}`,

      // כתובות חזרה
      CallBackUrl: CALLBACK_URL(),
      SuccessUrl: SUCCESS_URL(),
      CancelUrl: CANCEL_URL(),

      // עגלה עם פריט אחד (חובה בשביל AdjustAmount)
      CartItems: [
        {
          Description: `הטאבון - תשלום להזמנה ${orderId}`,
          Quantity: 1,
          Price: amount,
          Currency: "ILS"
        }
      ],

      // מאפשר ללקוח לשנות סכום (טיפ/השלמה)
      AdjustAmount: true,

      // מינימום UI (לא חובה)
      ShowCart: false
    };

    const resp = await axios.post(ZC_CREATE_SESSION_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
      validateStatus: () => true
    });

    // הרבה פעמים הם מחזירים JSON עם SessionUrl
    const data = resp.data;

    // אם הצליח – אמור להיות SessionUrl
    const sessionUrl = data?.SessionUrl || data?.sessionUrl || null;

    return res.status(200).json({
      ok: true,
      status: resp.status,
      sent: {
        Key: "[hidden]",
        UniqueID: payload.UniqueID,
        CallBackUrl: payload.CallBackUrl,
        SuccessUrl: payload.SuccessUrl,
        CancelUrl: payload.CancelUrl,
        AdjustAmount: payload.AdjustAmount,
        ShowCart: payload.ShowCart,
        CartItems: payload.CartItems
      },
      received: data,
      SessionUrl: sessionUrl
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

// דפי נחיתה
app.get("/payment-success", (req, res) => res.send("Payment Success ✅"));
app.get("/payment-cancel", (req, res) => res.send("Payment Cancelled ❌"));

// Callback – הם שולחים Async POST (שרת לשרת)
app.post("/zc-callback", express.json(), (req, res) => {
  console.log("ZC CALLBACK:", req.body);
  // פה בהמשך נעדכן Google Sheet / נשלח וואטסאפ וכו'
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
