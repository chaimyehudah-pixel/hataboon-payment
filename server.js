const express = require("express");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* =========================
   🔥 CORS – חובה בשביל האתר שלך
========================= */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

/* =========================
   ENV
========================= */
const PORT = process.env.PORT || 3000;

const ZC_KEY = process.env.ZC_KEY;
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;
const BASE_URL = process.env.BASE_URL;

const GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const SHEET_NAME = "payments";

/* =========================
   GOOGLE SHEETS
========================= */
function getSheets() {
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function appendPayment(row) {
  const sheets = getSheets();

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    valueInputOption: "RAW",
    requestBody: {
      values: [row]
    }
  });
}

/* =========================
   ZCREDIT
========================= */
async function createZCreditSession({ orderId, amount, name, phone }) {
  const uniqueId = "new-" + orderId + "-" + Date.now();

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,

    SuccessUrl: `${BASE_URL}/payment-success?orderId=${orderId}&uniqueId=${uniqueId}&source=new_order_system`,
    CancelUrl: `${BASE_URL}/payment-cancel?orderId=${orderId}&source=new_order_system`,
    CallBackUrl: `${BASE_URL}/zc-callback`,

    Currency: "ILS",
    Total: Number(amount),

    Customer: {
      Name: name,
      PhoneNumber: phone
    },

    AdditionalText: orderId,

    CartItems: [{
      Description: "תשלום להזמנה " + orderId,
      Quantity: 1,
      UnitPrice: Number(amount),
      Amount: Number(amount)
    }]
  };

  const response = await fetch("https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (data?.Data?.SessionUrl) {
    return data.Data.SessionUrl;
  }

  throw new Error(JSON.stringify(data));
}

/* =========================
   🔥 חדש – מהאתר שלך
========================= */
app.post("/create-order-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone } = req.body;

    const sessionUrl = await createZCreditSession({
      orderId,
      amount,
      name,
      phone
    });

    res.json({ url: sessionUrl });

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: "שגיאה ביצירת תשלום" });
  }
});

/* =========================
   CALLBACK מהאשראי
========================= */
app.post("/zc-callback", async (req, res) => {
  try {
    const body = req.body;

    if (!body.ApprovalNumber) {
      return res.send("OK");
    }

    const orderId = body.AdditionalText;

    await appendPayment([
      body.UniqueID,
      orderId,
      body.CustomerName || "",
      body.Phone || "",
      body.Total || "",
      body.ApprovalNumber,
      new Date().toLocaleString("he-IL"),
      "no",
      "",
      "new_order_system"
    ]);

    console.log("✔ payment saved");

  } catch (err) {
    console.error("callback error", err);
  }

  res.send("OK");
});

/* =========================
   SUCCESS
========================= */
app.get("/payment-success", (req, res) => {
  res.send(`
    <h1>התשלום עבר בהצלחה ✅</h1>
    <h2>מספר הזמנה: ${req.query.orderId}</h2>
  `);
});

/* =========================
   CANCEL
========================= */
app.get("/payment-cancel", (req, res) => {
  res.send(`
    <h1>התשלום בוטל ❌</h1>
  `);
});

/* =========================
   ⚠️ המערכת הישנה – לא נוגעים
========================= */
app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  res.send("מערכת תשלום ישנה");
});

/* ========================= */
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
