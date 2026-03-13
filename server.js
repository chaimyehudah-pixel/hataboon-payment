const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const GOOGLE_SERVICE_ACCOUNT = String(process.env.GOOGLE_SERVICE_ACCOUNT || "").trim();
const GOOGLE_SHEET_ID = String(process.env.GOOGLE_SHEET_ID || "").trim();

const SHEET_NAME = "payments";

const receiptsByUniqueId = new Map();
const receiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function cleanPhone(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function randomId() {
  return crypto.randomBytes(16).toString("hex");
}

function normalizePhoneDigits(phoneRaw) {
  let d = cleanPhone(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);
  return d.slice(0, 12);
}

function normalizePhoneLocal(phoneRaw) {
  let d = cleanPhone(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("972") && d.length >= 12) return "0" + d.slice(3, 12);
  if (d.startsWith("0")) return d.slice(0, 10);
  return d.slice(0, 10);
}

function formatIsraelDateTime(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}

function saveReceipt(uniqueId, orderId, receipt) {
  const finalUniqueId = String(uniqueId || "").trim();
  const finalOrderId = cleanOrderId(orderId || "");

  const rec = {
    ...receipt,
    uniqueId: finalUniqueId,
    orderId: finalOrderId
  };

  if (finalUniqueId) receiptsByUniqueId.set(finalUniqueId, rec);
  if (finalOrderId) receiptsByOrderId.set(finalOrderId, rec);
}

function getReceipt(uniqueId, orderId) {
  const cleanUniqueId = String(uniqueId || "").trim();
  const cleanId = cleanOrderId(orderId || "");

  if (cleanUniqueId && receiptsByUniqueId.has(cleanUniqueId)) {
    return receiptsByUniqueId.get(cleanUniqueId);
  }

  if (cleanId && receiptsByOrderId.has(cleanId)) {
    return receiptsByOrderId.get(cleanId);
  }

  return null;
}

function getGoogleCredentials() {
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  return credentials;
}

async function appendPaidPaymentToSheet({ token, orderId, name, phone, amount, approvalNumber, paymentDate }) {

  const credentials = getGoogleCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        String(token || ""),
        String(orderId || ""),
        String(name || ""),
        String(phone || ""),
        String(amount || ""),
        String(approvalNumber || ""),
        String(paymentDate || ""),
        "no"
      ]]
    }
  });
}

async function createZCreditSession({ orderId, amount, name, phone }) {

  const cleanId = cleanOrderId(orderId);
  const amountNumber = Number(amount);
  const phone972 = normalizePhoneDigits(phone);
  const phoneLocal = normalizePhoneLocal(phone);

  const uniqueId = "order-" + cleanId + "-" + Date.now() + "-" + randomId();

  saveReceipt(uniqueId, cleanId, {
    customerName: name,
    phone: phoneLocal,
    orderId: cleanId,
    amount: amountNumber,
    appendedToSheet: false
  });

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: BASE_URL + "/payment-success?orderId=" + cleanId + "&uniqueId=" + uniqueId,
    CancelUrl: BASE_URL + "/payment-cancel",
    Currency: "ILS",
    Total: amountNumber,
    AdditionalText: cleanId,
    ShowCart: false,
    Customer: {
      Name: name,
      PhoneNumber: phone972
    },
    CartItems: [{
      Description: "תשלום להזמנה " + cleanId,
      Quantity: 1,
      UnitPrice: amountNumber,
      Amount: amountNumber,
      Currency: "ILS"
    }]
  };

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (data?.Data?.SessionUrl) {
    return data.Data.SessionUrl;
  }

  throw new Error(JSON.stringify(data));
}

async function handleZcCallback(req, res) {

  try {

    const body = req.body || {};

    const uniqueId = String(body.UniqueID || "").trim();
    const orderId = cleanOrderId(body.AdditionalText || "");

    const existing = getReceipt(uniqueId, orderId) || {};

    const paymentDate = formatIsraelDateTime(new Date());

    const receipt = {
      ...existing,
      uniqueId,
      orderId,
      approval: String(body.ApprovalNumber || ""),
      transactionDateTimeFormatted: paymentDate
    };

    saveReceipt(uniqueId, orderId, receipt);

    if (!receipt.appendedToSheet) {

      await appendPaidPaymentToSheet({
        token: receipt.uniqueId,
        orderId: receipt.orderId,
        name: receipt.customerName || "",
        phone: receipt.phone || "",
        amount: receipt.amount || "",
        approvalNumber: receipt.approval || "",
        paymentDate
      });

      receipt.appendedToSheet = true;
      saveReceipt(uniqueId, orderId, receipt);
    }

  } catch (err) {
    console.error("zc-callback error:", err);
  }

  res.send("OK");
}

app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

app.post("/create-session", async (req, res) => {

  try {

    const { orderId, amount, name, phone } = req.body;

    const sessionUrl = await createZCreditSession({
      orderId,
      amount,
      name,
      phone
    });

    res.redirect(sessionUrl);

  } catch (err) {

    console.error(err);
    res.send("שגיאה ביצירת תשלום");

  }

});

app.all("/zc-callback", handleZcCallback);

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
