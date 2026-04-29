const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ZCREDIT
const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

// GOOGLE SHEETS
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "payments";

// =======================
// 🔐 Google Sheets Auth
// =======================
const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_SERVICE_ACCOUNT,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function appendPaymentToSheet(data) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        data.token || "",
        data.orderId || "",
        data.name || "",
        data.phone || "",
        data.amount || "",
        data.approvalNumber || "",
        data.paymentDate || "",
        data.handled || "",
        "", // מספר קבלה רץ (אם יש לך לוגיקה – תוסיף)
        data.last4 || "",
        data.source || ""   // ⭐️ החדש
      ]]
    }
  });
}

// =======================
// 💳 יצירת סשן תשלום
// =======================
async function createZCreditSession(order) {
  const payload = {
    TerminalNumber: ZC_TERMINAL,
    Username: ZC_KEY,
    Password: ZC_PASSWORD,
    Amount: order.amount,
    Currency: "ILS",
    Order: order.orderId,
    SuccessUrl: `${BASE_URL}/payment-success`,
    CancelUrl: `${BASE_URL}/payment-cancel`,
    Customer: {
      Name: order.name,
      PhoneNumber: order.phone
    },
    AdditionalText: "new_order_system"
  };

  const res = await fetch("https://pci.zcredit.co.il/WebCheckout/api/WebCheckout/CreateSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (res.ok && data?.Data?.SessionUrl) {
    return data.Data.SessionUrl;
  }

  throw new Error(JSON.stringify(data));
}

// =======================
// 🚀 יצירת הזמנה + מעבר לתשלום
// =======================
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
    console.error("ZCredit error:", err.message);
    res.status(500).json({ error: "שגיאה ביצירת תשלום" });
  }
});

// =======================
// ✅ הצלחה
// =======================
app.get("/payment-success", async (req, res) => {
  try {
    const { Order, ApprovalNumber, Card4Digits } = req.query;

    await appendPaymentToSheet({
      token: crypto.randomUUID(),
      orderId: Order,
      name: "",
      phone: "",
      amount: "",
      approvalNumber: ApprovalNumber,
      paymentDate: new Date().toLocaleString("he-IL"),
      handled: "1",
      last4: Card4Digits,
      source: "new_order_system" // ⭐️ חשוב
    });

    res.send(`
      <h1>✅ התשלום עבר בהצלחה</h1>
      <h3>מספר הזמנה: ${Order}</h3>
    `);

  } catch (err) {
    console.error(err);
    res.send("שגיאה בעדכון תשלום");
  }
});

// =======================
// ❌ ביטול
// =======================
app.get("/payment-cancel", (req, res) => {
  res.send("<h1>❌ התשלום בוטל</h1>");
});

// =======================
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
