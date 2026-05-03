const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;

const GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const receipts = new Map();

/* ================= GOOGLE ================= */

function getSheets() {
  const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  creds.private_key = creds.private_key.replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function saveToSheet(data) {
  const sheets = getSheets();

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "payments!A:K",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        data.token,
        data.orderId,
        data.name,
        data.phone,
        data.amount,
        data.approval,
        new Date().toLocaleString("he-IL"),
        "no",
        "",
        data.last4,
        data.source
      ]]
    }
  });
}

/* ================= ZC ================= */

function normalizePhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "972" + p.slice(1);
  return p;
}

async function createSession({ orderId, amount, name, phone }) {
  const uniqueId = "order-" + orderId + "-" + Date.now();

  receipts.set(uniqueId, {
    orderId,
    name,
    phone,
    amount,
    source: "manual"
  });

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: BASE_URL + "/payment-success",
    CancelUrl: BASE_URL + "/payment-cancel",
    Total: Number(amount),
    Currency: "ILS",
    Customer: {
      Name: name,
      PhoneNumber: normalizePhone(phone)
    }
  };

  const res = await fetch("https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!data?.Data?.SessionUrl) throw new Error("ZC failed");

  return data.Data.SessionUrl;
}

/* ================= UI ================= */

function payPage(orderId, amount, phone) {
  return `
  <html dir="rtl">
  <body style="font-family:Arial;text-align:center;margin-top:60px">
  <h2>תשלום להזמנה ${orderId}</h2>
  <h3>₪${amount}</h3>
  <form method="POST" action="/create-session">
  <input type="hidden" name="orderId" value="${orderId}">
  <input type="hidden" name="amount" value="${amount}">
  <input type="hidden" name="phone" value="${phone}">
  <input name="name" placeholder="שם מלא" required>
  <br><br>
  <button>לתשלום</button>
  </form>
  </body>
  </html>
  `;
}

/* ================= ROUTES ================= */

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  res.send(payPage(
    req.params.orderId,
    req.params.amount,
    req.params.phone
  ));
});

app.post("/create-session", async (req, res) => {
  try {
    const url = await createSession(req.body);
    res.redirect(url);
  } catch (e) {
    res.send("שגיאה");
  }
});

/* ================= CALLBACK ================= */

app.post("/zc-callback", (req, res) => {
  res.send("OK"); // 🔥 חובה מיד

  setTimeout(async () => {
    try {
      const body = req.body;

      const rec = receipts.get(body.UniqueID) || {};

      await saveToSheet({
        token: body.UniqueID,
        orderId: rec.orderId || body.AdditionalText,
        name: body.CustomerName,
        phone: body.CustomerPhone,
        amount: body.Total,
        approval: body.ApprovalNumber,
        last4: (body.CardNum || "").slice(-4),
        source: rec.source || "unknown"
      });

      console.log("saved payment");

    } catch (err) {
      console.error(err);
    }
  }, 0);
});

/* ================= SUCCESS ================= */

app.get("/payment-success", (req, res) => {
  res.send("<h1>התשלום עבר בהצלחה ✅</h1>");
});

app.get("/payment-cancel", (req, res) => {
  res.send("<h1>התשלום בוטל ❌</h1>");
});

app.listen(PORT, () => {
  console.log("server running");
});
