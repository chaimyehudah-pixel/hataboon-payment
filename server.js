const express = require("express");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const GOOGLE_SERVICE_ACCOUNT = String(process.env.GOOGLE_SERVICE_ACCOUNT || "").trim();
const GOOGLE_SHEET_ID = String(process.env.GOOGLE_SHEET_ID || "").trim();

const receipts = new Map();

/* ================= HELPERS ================= */

function cleanDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function normalizePhoneLocal(phone) {
  let p = cleanDigits(phone);
  if (p.startsWith("972")) return "0" + p.slice(3);
  return p;
}

function normalizePhone972(phone) {
  let p = cleanDigits(phone);
  if (p.startsWith("0")) return "972" + p.slice(1);
  return p;
}

function normalizeSource(source) {
  const s = String(source || "").trim().toLowerCase();
  if (s === "payment_request" || s === "pr" || s === "proforma") return "payment_request";
  if (s === "new_order_system") return "new_order_system";
  if (s === "manual_payment_link" || s === "payment_link" || s === "manual" || !s) return "manual_payment_link";
  return s;
}

function sourceFromUniqueId(uniqueId) {
  const s = String(uniqueId || "");
  if (s.startsWith("pr-order-")) return "payment_request";
  if (s.startsWith("order-")) return "manual_payment_link";
  return "";
}

function tokenPrefixForSource(source) {
  return normalizeSource(source) === "payment_request" ? "pr-order" : "order";
}

function escapeHtml(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getSourceLabel(source) {
  return normalizeSource(source) === "payment_request" ? "תשלום עבור חשבון עסקה" : "תשלום רגיל להזמנה";
}

function getCartDescription(orderId, source) {
  return normalizeSource(source) === "payment_request"
    ? "תשלום עבור חשבון עסקה להזמנה " + orderId
    : "תשלום להזמנה " + orderId;
}

function getSuccessUrl(cleanOrderId, source) {
  return BASE_URL +
    "/payment-success?orderId=" +
    encodeURIComponent(cleanOrderId) +
    "&source=" +
    encodeURIComponent(normalizeSource(source));
}

function getCancelUrl(cleanOrderId, source) {
  return BASE_URL +
    "/payment-cancel?orderId=" +
    encodeURIComponent(cleanOrderId) +
    "&source=" +
    encodeURIComponent(normalizeSource(source));
}

function getNowIsrael() {
  return new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem"
  });
}

function pickFirst(body, names) {
  for (const name of names) {
    if (body && body[name] !== undefined && body[name] !== null && String(body[name]).trim() !== "") {
      return String(body[name]).trim();
    }
  }
  return "";
}

function findValueByKeyIncludes(obj, keywords) {
  if (!obj || typeof obj !== "object") return "";
  const lowered = keywords.map(k => String(k).toLowerCase());

  for (const [key, val] of Object.entries(obj)) {
    const k = String(key).toLowerCase();
    if (lowered.some(word => k.includes(word)) && val !== undefined && val !== null && String(val).trim() !== "") {
      return String(val).trim();
    }
  }
  return "";
}

function extractEmail(body) {
  return pickFirst(body, [
    "CustomerEmail",
    "Email",
    "ClientEmail",
    "PayerEmail",
    "Mail",
    "EMail",
    "email",
    "customer_email"
  ]) || findValueByKeyIncludes(body, ["email", "mail"]);
}

function extractCustomerIdNumber(body) {
  return cleanDigits(pickFirst(body, [
    "HolderId",
    "CustomerID",
    "CustomerId",
    "CustomerIdNumber",
    "CustomerIdentity",
    "IdentityNumber",
    "IdNumber",
    "IDNumber",
    "TZ",
    "TeudatZehut",
    "SocialId",
    "VatNumber",
    "CompanyId"
  ]) || findValueByKeyIncludes(body, ["holderid", "identity", "idnumber", "customerid", "vat", "tz", "zehut"]));
}

function extractLast4(body) {
  const raw =
    body.CardNum ||
    body.CardMask ||
    body.CardNumber ||
    body.Pan ||
    body.PAN ||
    "";

  const d = cleanDigits(raw);
  return d.length >= 4 ? d.slice(-4) : "";
}

function extractVoucherNumber(body) {
  return pickFirst(body, [
    "VoucherNumber",
    "Voucher",
    "Shovar",
    "ShovarNumber",
    "SlipNumber"
  ]);
}

function extractZCreditToken(body) {
  return pickFirst(body, [
    "Token",
    "ZCreditToken",
    "CardToken",
    "CardTokenId"
  ]);
}

function extractZCreditPaymentMethod(body) {
  return pickFirst(body, [
    "PaymentMethod",
    "ZCreditPaymentMethod",
    "PaymentType",
    "WalletType",
    "CardEntryMode",
    "EntryMode"
  ]);
}

function detectCreditEntryType(body) {
  const method = String(extractZCreditPaymentMethod(body) || "").trim();

  // Known from live ZCredit callbacks:
  // 0 = regular credit card / manual card entry
  // 6 = Google Pay
  if (method === "0") return "regular_credit";
  if (method === "6") return "google_pay";

  const raw = [
    method,
    pickFirst(body, [
      "WalletType", "Wallet", "DigitalWallet", "CardWallet",
      "CardEntryMode", "EntryMode", "PaymentType",
      "CardInputType", "TokenType", "Issuer", "Eci", "ECI"
    ]),
    findValueByKeyIncludes(body, ["wallet", "entry", "method", "apple", "google", "digital", "token", "eci"])
  ].filter(Boolean).join(" | ");

  const s = raw.toLowerCase();

  if (s.includes("apple")) return "apple_pay";
  if (s.includes("google")) return "google_pay";
  if (s.includes("wallet") || s.includes("digital")) return "digital_wallet";
  if (s.includes("manual") || s.includes("typed") || s.includes("keyed")) return "manual_card";
  if (s.includes("credit")) return "regular_credit";

  return method ? `unknown_${method}` : (raw || "unknown");
}

function detectCardBrand(body) {
  const cardName = String(body.CardName || "").toLowerCase();
  const cardBin = cleanDigits(body.CardBin || "");
  const brandCode = String(body.CardBrandCode || "").trim();

  if (cardName.includes("visa") || cardName.includes("ויזה")) return "visa";
  if (cardName.includes("master") || cardName.includes("מסטר")) return "mastercard";
  if (cardName.includes("amex") || cardName.includes("american") || cardName.includes("אמריקן")) return "amex";
  if (cardName.includes("diners") || cardName.includes("דיינרס")) return "diners";
  if (cardName.includes("ישראכרט")) return "isracard";

  if (cardBin.startsWith("4")) return "visa";
  if (cardBin.startsWith("5")) return "mastercard";
  if (cardBin.startsWith("34") || cardBin.startsWith("37")) return "amex";
  if (cardBin.startsWith("30") || cardBin.startsWith("36") || cardBin.startsWith("38")) return "diners";

  return brandCode ? `code_${brandCode}` : "";
}

/* ================= GOOGLE ================= */

function getSheets() {
  if (!GOOGLE_SERVICE_ACCOUNT) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT");
  }

  if (!GOOGLE_SHEET_ID) {
    throw new Error("Missing GOOGLE_SHEET_ID");
  }

  const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT);
  creds.private_key = String(creds.private_key || "").replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function saveToSheet(data) {
  const sheets = getSheets();

  // Schema A:AI
  // A  Token
  // B  OrderId
  // C  OrderDateTime
  // D  CustomerName
  // E  Phone
  // F  Email
  // G  CustomerIdNumber
  // H  Amount
  // I  ApprovalNumber
  // J  PaymentDate
  // K  DocumentType
  // L  PaymentMethod
  // M  Subject
  // N  Remarks
  // O  LinkedDocumentToken
  // P  LinkedDocumentNumber
  // Q  Status
  // R  DocumentNumber
  // S  PublicUrl
  // T  AdminUrl
  // U  MailSent
  // V  Error
  // W  CreditLast4
  // X  VoucherNumber
  // Y  ZCreditPaymentMethod
  // Z  CreditEntryType
  // AA ZCreditToken
  // AB CardBrandCode
  // AC CardBrand
  // AD CardName
  // AE CardBin
  // AF CardIssuerCode
  // AG CardFinancerCode
  // AH Source
  // AI PaymentRequestMatched

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "payments!A:AI",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        String(data.token || ""),
        String(data.orderId || ""),
        String(data.orderDateTime || ""),
        String(data.name || ""),
        String(data.phone || ""),
        String(data.email || ""),
        String(data.customerIdNumber || ""),
        String(data.amount || ""),
        String(data.approval || ""),
        String(data.paymentDate || getNowIsrael()),
        String(data.documentType || "receipt"),
        String(data.paymentMethod || "credit"),
        String(data.subject || ""),
        String(data.remarks || data.source || ""),
        String(data.linkedDocumentToken || ""),
        String(data.linkedDocumentNumber || ""),
        "no",
        String(data.documentNumber || ""),
        String(data.publicUrl || ""),
        String(data.adminUrl || ""),
        String(data.mailSent || ""),
        String(data.error || ""),
        String(data.last4 || ""),
        String(data.voucherNumber || ""),
        String(data.zcreditPaymentMethod || ""),
        String(data.creditEntryType || ""),
        String(data.zcreditToken || ""),
        String(data.cardBrandCode || ""),
        String(data.cardBrand || ""),
        String(data.cardName || ""),
        String(data.cardBin || ""),
        String(data.cardIssuerCode || ""),
        String(data.cardFinancerCode || ""),
        String(normalizeSource(data.source || "")),
        String(data.paymentRequestMatched || "")
      ]]
    }
  });
}

/* ================= ZCREDIT ================= */

async function createSession({ orderId, amount, name, phone, source }) {
  const cleanOrderId = cleanDigits(orderId);
  const amountNumber = Number(String(amount || "").replace(",", "."));
  const customerName = String(name || "").trim();
  const phone972 = normalizePhone972(phone);
  const phoneLocal = normalizePhoneLocal(phone);
  const normalizedSource = normalizeSource(source);

  if (!BASE_URL || !ZC_KEY || !ZC_TERMINAL || !ZC_PASSWORD) {
    throw new Error("Missing payment server configuration");
  }

  if (!cleanOrderId) {
    throw new Error("Invalid orderId");
  }

  if (!amountNumber || amountNumber <= 0) {
    throw new Error("Invalid amount");
  }

  if (!customerName) {
    throw new Error("Missing customer name");
  }

  if (!phone972) {
    throw new Error("Missing phone");
  }

  const uniqueId =
    tokenPrefixForSource(normalizedSource) +
    "-" +
    cleanOrderId +
    "-" +
    Date.now() +
    "-" +
    crypto.randomBytes(8).toString("hex");

  receipts.set(uniqueId, {
    token: uniqueId,
    orderId: cleanOrderId,
    name: customerName,
    phone: phoneLocal,
    amount: amountNumber,
    source: normalizedSource,
    saved: false
  });

  const payload = {
    Key: ZC_KEY,
    TerminalNumber: ZC_TERMINAL,
    Password: ZC_PASSWORD,
    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    CallbackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: getSuccessUrl(cleanOrderId, normalizedSource),
    CancelUrl: getCancelUrl(cleanOrderId, normalizedSource),
    Total: amountNumber,
    Currency: "ILS",
    AdditionalText: cleanOrderId,
    ShowCart: false,
    Customer: {
      Name: customerName,
      PhoneNumber: phone972
    },
    CartItems: [
      {
        Description: getCartDescription(cleanOrderId, normalizedSource),
        Quantity: 1,
        UnitPrice: amountNumber,
        Amount: amountNumber,
        Currency: "ILS"
      }
    ]
  };

  console.log("Creating ZCredit session:", {
    orderId: cleanOrderId,
    amount: amountNumber,
    name: customerName,
    phone: phone972,
    source: normalizedSource,
    callback: payload.CallBackUrl
  });

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error("ZCredit invalid JSON:", text);
    throw new Error("ZCredit returned invalid JSON");
  }

  const sessionUrl = data?.Data?.SessionUrl || data?.SessionUrl;

  console.log("ZCredit session created:", {
    ok: response.ok,
    hasError: !!data?.HasError,
    sessionId: data?.Data?.SessionId || "",
    hasSessionUrl: !!sessionUrl
  });

  if (!response.ok || !sessionUrl) {
    throw new Error("ZCredit failed: " + JSON.stringify(data));
  }

  return sessionUrl;
}

/* ================= UI ================= */

function payPage({ orderId, amount, phone, source }) {
  const normalizedSource = normalizeSource(source);
  const title = getSourceLabel(normalizedSource);
  const safeOrderId = escapeHtml(orderId);
  const safeAmount = escapeHtml(amount);
  const safePhone = escapeHtml(phone || "");
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:Arial;background:#f4f4f4;text-align:center;padding:30px}
.box{background:white;max-width:460px;margin:auto;padding:25px;border-radius:14px}
input,button{width:100%;box-sizing:border-box;padding:14px;margin:8px 0;font-size:18px}
button{background:#159947;color:white;border:0;border-radius:8px;cursor:pointer;font-weight:bold}
.info{background:#fafafa;border:1px solid #ddd;border-radius:8px;padding:12px;text-align:right;margin-bottom:15px}
.small{font-size:14px;color:#666;margin-top:10px}
</style>
</head>
<body>
<div class="box">
<h2>${title}</h2>

<div class="info">
<div><b>מספר הזמנה:</b> ${safeOrderId}</div>
<div><b>סכום:</b> ₪${safeAmount}</div>
${safePhone ? `<div><b>טלפון:</b> ${safePhone}</div>` : ""}
</div>

<form method="POST" action="/create-session">
<input type="hidden" name="orderId" value="${safeOrderId}">
<input type="hidden" name="amount" value="${safeAmount}">
<input type="hidden" name="phone" value="${safePhone}">
<input type="hidden" name="source" value="${normalizedSource}">

<input name="name" placeholder="שם מלא" required autocomplete="name">

<button type="submit">מעבר לתשלום</button>
</form>

<div class="small">אין אפשרות לשנות מספר הזמנה, סכום או טלפון.</div>
</div>
</body>
</html>
`;
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.send("Hataboon payment server is running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    baseUrl: !!BASE_URL,
    zcredit: !!(ZC_KEY && ZC_TERMINAL && ZC_PASSWORD),
    google: !!(GOOGLE_SERVICE_ACCOUNT && GOOGLE_SHEET_ID)
  });
});


app.get("/pay/:phone/:orderId/:amount/pr", (req, res) => {
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanDigits(req.params.orderId);
  const amount = Number(String(req.params.amount || "").replace(",", "."));

  if (!orderId) return res.status(400).send("מספר הזמנה לא תקין");
  if (!amount || amount <= 0) return res.status(400).send("סכום לא תקין");

  res.send(payPage({ orderId, amount, phone, source: "payment_request" }));
});

app.get("/pay/:orderId/:amount/pr", (req, res) => {
  const orderId = cleanDigits(req.params.orderId);
  const amount = Number(String(req.params.amount || "").replace(",", "."));

  if (!orderId) return res.status(400).send("מספר הזמנה לא תקין");
  if (!amount || amount <= 0) return res.status(400).send("סכום לא תקין");

  res.send(payPage({ orderId, amount, phone: "", source: "payment_request" }));
});

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanDigits(req.params.orderId);
  const amount = Number(String(req.params.amount || "").replace(",", "."));

  if (!orderId) return res.status(400).send("מספר הזמנה לא תקין");
  if (!amount || amount <= 0) return res.status(400).send("סכום לא תקין");

  res.send(payPage({ orderId, amount, phone, source: "manual_payment_link" }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanDigits(req.params.orderId);
  const amount = Number(String(req.params.amount || "").replace(",", "."));

  if (!orderId) return res.status(400).send("מספר הזמנה לא תקין");
  if (!amount || amount <= 0) return res.status(400).send("סכום לא תקין");

  res.send(payPage({ orderId, amount, phone: "", source: "manual_payment_link" }));
});

app.post("/create-session", async (req, res) => {
  try {
    const url = await createSession(req.body);
    res.redirect(url);
  } catch (err) {
    console.error("create-session error:", err.message);
    res.status(500).send("שגיאה ביצירת תשלום: " + err.message);
  }
});

app.post("/create-order-session", async (req, res) => {
  try {
    const url = await createSession({
      ...req.body,
      source: "new_order_system"
    });

    res.json({
      ok: true,
      url,
      sessionUrl: url
    });
  } catch (err) {
    console.error("create-order-session error:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* ================= CALLBACK ================= */

function extractOrderIdFromUniqueId(uniqueId) {
  const match = String(uniqueId || "").match(/^(?:pr-order|order)-(\d+)-/);
  return match ? match[1] : "";
}

async function processCallback(body) {
  try {
    console.log("ZCredit callback body:", JSON.stringify(body, null, 2));

    const uniqueId = String(body.UniqueID || body.UniqueId || body.UID || "").trim();
    const approval = String(body.ApprovalNumber || body.AuthNumber || body.ConfirmationCode || "").trim();

    if (!approval) {
      console.log("callback ignored: no approval number");
      return;
    }

    const rec = receipts.get(uniqueId) || {};
    const callbackSource = normalizeSource(
      rec.source ||
      sourceFromUniqueId(uniqueId) ||
      body.Source ||
      body.source ||
      "manual_payment_link"
    );

    if (rec.saved) {
      console.log("callback duplicate ignored:", uniqueId);
      return;
    }

    const paymentData = {
      token: uniqueId,
      orderId:
        rec.orderId ||
        cleanDigits(body.AdditionalText) ||
        extractOrderIdFromUniqueId(uniqueId) ||
        cleanDigits(body.ReferenceNumber),
      orderDateTime: "",
      name: rec.name || String(body.CustomerName || body.Name || "").trim(),
      phone: rec.phone || normalizePhoneLocal(body.CustomerPhone || body.Phone || ""),
      email: extractEmail(body),
      customerIdNumber: extractCustomerIdNumber(body),
      amount: rec.amount || body.Total || "",
      approval,
      voucherNumber: extractVoucherNumber(body),
      paymentDate: getNowIsrael(),
      documentType: "receipt",
      paymentMethod: "credit",
      subject: "",
      remarks: callbackSource,
      linkedDocumentToken: "",
      linkedDocumentNumber: "",
      documentNumber: "",
      publicUrl: "",
      adminUrl: "",
      mailSent: "",
      error: "",
      last4: extractLast4(body),
      zcreditPaymentMethod: extractZCreditPaymentMethod(body),
      creditEntryType: detectCreditEntryType(body),
      zcreditToken: extractZCreditToken(body),
      cardBrandCode: String(body.CardBrandCode || ""),
      cardBrand: detectCardBrand(body),
      cardName: String(body.CardName || ""),
      cardBin: cleanDigits(body.CardBin || ""),
      cardIssuerCode: String(body.CardIssuerCode || ""),
      cardFinancerCode: String(body.CardFinancerCode || ""),
      source: callbackSource,
      paymentRequestMatched: ""
    };

    console.log("parsed payment data for sheet:", JSON.stringify(paymentData, null, 2));

    await saveToSheet(paymentData);

    receipts.set(uniqueId, {
      ...rec,
      saved: true,
      approval
    });

    console.log("saved payment:", paymentData);
  } catch (err) {
    console.error("callback save error:", err.message);
  }
}

app.all("/zc-callback", (req, res) => {
  const body = req.method === "GET" ? req.query : req.body;

  res.status(200).send("OK");

  setImmediate(() => {
    processCallback(body || {});
  });
});

/* ================= SUCCESS ================= */

app.get("/payment-success", (req, res) => {
  const orderId = cleanDigits(req.query.orderId || "");
  const source = normalizeSource(req.query.source || "");
  const title = source === "payment_request" ? "התשלום עבור חשבון העסקה עבר בהצלחה" : "התשלום עבר בהצלחה";

  res.send(`
<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>התשלום עבר</title></head>
<body style="font-family:Arial;text-align:center;margin-top:80px">
<h1>✅ ${title}</h1>
${orderId ? `<h2>מספר הזמנה: ${orderId}</h2>` : ""}
</body>
</html>
`);
});

app.get("/payment-cancel", (req, res) => {
  const orderId = cleanDigits(req.query.orderId || "");
  const source = normalizeSource(req.query.source || "");
  const title = source === "payment_request" ? "התשלום עבור חשבון העסקה בוטל" : "התשלום בוטל";

  res.send(`
<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>התשלום בוטל</title></head>
<body style="font-family:Arial;text-align:center;margin-top:80px">
<h1>❌ ${title}</h1>
${orderId ? `<h2>מספר הזמנה: ${orderId}</h2>` : ""}
</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log("server running on port", PORT);
});
