const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TERMINAL = process.env.ZC_TERMINAL;
const PASSWORD = process.env.ZC_PASSWORD;
const BASE_URL = process.env.BASE_URL;
const KEY = "c0863aa14e77ec032effda671797c295d8a2ab154e49242871a197d158fa3f30";

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🚀");
});

app.get("/create-payment", async (req, res) => {
  try {
    const amount = 10.00;
    const orderId = "ORDER_" + Date.now();

    const hashString = TERMINAL + PASSWORD + amount + orderId + KEY;
    const hash = crypto.createHash("sha256").update(hashString).digest("hex");

    const response = await axios.post("https://pci.zcredit.co.il/WebControl/RequestToken.aspx", {
      TerminalNumber: TERMINAL,
      TerminalPassword: PASSWORD,
      Amount: amount,
      Currency: "ILS",
      OrderID: orderId,
      SuccessUrl: `${BASE_URL}/payment-success`,
      CancelUrl: `${BASE_URL}/payment-cancel`,
      CallbackUrl: `${BASE_URL}/payment-callback`,
      Hash: hash
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/payment-callback", (req, res) => {
  console.log("Callback received:", req.body);
  res.sendStatus(200);
});

app.get("/payment-success", (req, res) => {
  res.send("Payment Success ✅");
});

app.get("/payment-cancel", (req, res) => {
  res.send("Payment Cancelled ❌");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
