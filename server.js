const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ZC_KEY = process.env.ZC_KEY || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

const ZC_CREATE_SESSION_URL =
  "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession/";

// תראה שזה הקוד החדש רץ
const APP_VERSION = "v3-total-unitprice-amount";

function mustEnv(name, value) {
  if (!value) throw new Error(`Missing env var: ${name}`);
}

app.get("/", (req, res) => res.send("Hataboon Payment Server Running 🚀"));

app.get("/version", (req, res) => {
  res.json({ ok: true, version: APP_VERSION });
});

app.get("/env-check", (req, res) => {
  res.json({
    ok: true,
    has: { ZC_KEY: !!ZC_KEY, BASE_URL: !!BASE_URL },
    baseUrl: BASE_URL || null,
    version: APP_VERSION
  });
});

app.get("/create-session", async (req, res) => {
  try {
    mustEnv("ZC_KEY", ZC_KEY);
    mustEnv("BASE_URL", BASE_URL);

    const orderId = String(req.query.orderId || "999");
    const amountNum = Number(req.query.amount || "12");

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const payload = {
      Key: ZC_KEY,
      UniqueID: `order-${orderId}`,

      CallBackUrl: `${BASE_URL}/zc-callback`,
      SuccessUrl: `${BASE_URL}/payment-success`,
      CancelUrl: `${BASE_URL}/payment-cancel`,

      Currency: "ILS",
      Total: amountNum,

      AdjustAmount: true,
      ShowCart: false,

      CartItems: [
        {
          Description: `הטאבון - תשלום להזמנה ${orderId}`,
          Quantity: 1,
          UnitPrice: amountNum,
          Amount: amountNum,
          Currency: "ILS"
        }
      ]
    };

    const resp = await axios.post(ZC_CREATE_SESSION_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
      validateStatus: () => true
    });

    const data = resp.data;
    const sessionUrl =
      data?.Data?.SessionUrl || data?.SessionUrl || data?.sessionUrl || null;

    res.json({
      ok: true,
      status: resp.status,
      version: APP_VERSION,
      sent: {
        Key: "[hidden]",
        UniqueID: payload.UniqueID,
        CallBackUrl: payload.CallBackUrl,
        SuccessUrl: payload.SuccessUrl,
        CancelUrl: payload.CancelUrl,
        Currency: payload.Currency,
        Total: payload.Total,
        AdjustAmount: payload.AdjustAmount,
        ShowCart: payload.ShowCart,
        CartItems: payload.CartItems
      },
      received: data,
      SessionUrl: sessionUrl
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/payment-success", (req, res) => res.send("Payment Success ✅"));
app.get("/payment-cancel", (req, res) => res.send("Payment Cancelled ❌"));

app.post("/zc-callback", (req, res) => {
  console.log("ZC CALLBACK:", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
