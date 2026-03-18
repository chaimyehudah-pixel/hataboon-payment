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

const BUSINESS_NAME = "פיצת הטאבון";
const BUSINESS_PHONE = "029605556";
const BUSINESS_ADDRESS = 'א.התעשייה קריית-ארבע - חברון, רחוב משה בוסאני לוי 11';
const BUSINESS_CANCEL_PHONE = "029605556";
const BUSINESS_CANCEL_EXT_1 = "4";
const BUSINESS_CANCEL_EXT_2 = "7";
const BUSINESS_WHATSAPP_URL = "https://wa.me/972524150000";

const receiptsByUniqueId = new Map();
const receiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function cleanPhone(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function htmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const finalUniqueId = String(uniqueId || receipt.uniqueId || "").trim();
  const finalOrderId = cleanOrderId(orderId || receipt.orderId || "");

  const rec = {
    ...receipt,
    uniqueId: finalUniqueId,
    orderId: finalOrderId
  };

  if (finalUniqueId) {
    receiptsByUniqueId.set(finalUniqueId, rec);
  }

  if (finalOrderId) {
    receiptsByOrderId.set(finalOrderId, rec);
  }
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
  credentials.private_key = String(credentials.private_key || "").replace(/\\n/g, "\n");
  return credentials;
}

function createSheetsClient() {
  const credentials = getGoogleCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function appendPaidPaymentToSheet({
  token,
  orderId,
  name,
  phone,
  amount,
  approvalNumber,
  paymentDate
}) {
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) return;

  const sheets = createSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: "RAW",
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

async function findPaymentByTokenInSheet(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return null;
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) return null;

  const sheets = createSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:H`
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowToken = String(row[0] || "").trim();

    if (rowToken === cleanToken) {
      return {
        token: String(row[0] || "").trim(),
        orderId: cleanOrderId(row[1] || ""),
        customerName: String(row[2] || "").trim(),
        phone: String(row[3] || "").trim(),
        amount: String(row[4] || "").trim(),
        approval: String(row[5] || "").trim(),
        transactionDateTimeFormatted: String(row[6] || "").trim(),
        handled: String(row[7] || "").trim()
      };
    }
  }

  return null;
}

function hasRealApproval(body) {
  const approvalNumber = String(body?.ApprovalNumber || "").trim();
  return approvalNumber !== "";
}

function parsePositiveAmount(value) {
  const normalized = String(value || "").replace(",", ".").trim();
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Number(amount.toFixed(2));
}

async function createZCreditSession({ orderId, amount, name, phone }) {
  const cleanId = cleanOrderId(orderId);
  const customerName = String(name || "").trim();
  const amountNumber = parsePositiveAmount(amount);
  const phone972 = normalizePhoneDigits(phone);
  const phoneLocal = normalizePhoneLocal(phone);

  if (!cleanId) throw new Error("Invalid orderId");
  if (!customerName) throw new Error("Missing name");
  if (!amountNumber) throw new Error("Invalid amount");
  if (!phone972) throw new Error("Invalid phone");
  if (!BASE_URL || !ZC_KEY || !ZC_TERMINAL || !ZC_PASSWORD) {
    throw new Error("Missing payment server configuration");
  }

  const uniqueId = "order-" + cleanId + "-" + Date.now() + "-" + randomId();

  saveReceipt(uniqueId, cleanId, {
    customerName,
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
    SuccessUrl:
      BASE_URL +
      "/payment-success?orderId=" +
      encodeURIComponent(cleanId) +
      "&uniqueId=" +
      encodeURIComponent(uniqueId),
    CancelUrl:
      BASE_URL +
      "/payment-cancel?orderId=" +
      encodeURIComponent(cleanId),
    Currency: "ILS",
    Total: amountNumber,
    AdditionalText: cleanId,
    ShowCart: false,
    Customer: {
      Name: customerName,
      PhoneNumber: phone972
    },
    CartItems: [
      {
        Description: "תשלום להזמנה " + cleanId,
        Quantity: 1,
        UnitPrice: amountNumber,
        Amount: amountNumber,
        Currency: "ILS"
      }
    ]
  };

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (response.ok && data?.Data?.SessionUrl) {
    return data.Data.SessionUrl;
  }

  throw new Error("ZCredit CreateSession failed: " + JSON.stringify(data));
}

function renderLayout({ title, body }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<title>${htmlEscape(title)}</title>
<style>
html{
  -webkit-text-size-adjust:100%;
  text-size-adjust:100%;
  overflow-x:hidden;
}
body{
  font-family:Arial,Helvetica,sans-serif;
  background:#f4f4f4;
  padding:16px;
  margin:0;
  color:#111;
}
*{
  box-sizing:border-box;
}
.card{
  max-width:760px;
  width:100%;
  margin:18px auto;
  background:#fff;
  border-radius:20px;
  padding:24px;
  box-shadow:0 10px 30px rgba(0,0,0,.08);
}
.logo{
  text-align:center;
  margin-bottom:14px;
}
.logo img{
  max-width:190px;
  width:100%;
  height:auto;
}
h1,h2,h3{
  margin-top:0;
}
p{
  line-height:1.65;
}
.info-list{
  margin:0;
  padding:0;
  list-style:none;
}
.info-list li{
  margin:10px 0;
  padding:12px 14px;
  background:#fafafa;
  border:1px solid #eee;
  border-radius:12px;
}
button,
input,
select,
textarea,
a.btn{
  width:100%;
  padding:12px;
  border-radius:10px;
  border:1px solid #ddd;
  margin-top:10px;
  box-sizing:border-box;
  font-size:16px;
  line-height:1.3;
  -webkit-appearance:none;
  appearance:none;
}
button,
a.btn.primary{
  border:0;
  background:#c40000;
  color:#fff;
  font-weight:bold;
  cursor:pointer;
  text-decoration:none;
  display:inline-block;
  text-align:center;
}
a.btn.secondary{
  background:#fff;
  color:#111;
  text-decoration:none;
}
a.btn.green{
  border:0;
  background:#1f8f4e;
  color:#fff;
  font-weight:bold;
  cursor:pointer;
  text-decoration:none;
  display:inline-block;
  text-align:center;
}
label{
  font-weight:bold;
  margin-top:14px;
  display:block;
}
.notice{
  background:#fff8e8;
  border:1px solid #f0d99b;
  padding:12px 14px;
  border-radius:12px;
  margin:14px 0;
}
.footer-links{
  margin-top:18px;
  padding-top:14px;
  border-top:1px solid #eee;
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}
.footer-links a{
  color:#0b57d0;
  text-decoration:none;
}
.small{
  font-size:14px;
  color:#444;
}
.field-block{
  padding:10px 0 8px;
  border-bottom:1px solid #eee;
}
.field-block:last-child{
  border-bottom:none;
}
.field-label{
  font-size:13px;
  font-weight:800;
  color:#333;
  margin-bottom:4px;
}
.field-value{
  font-size:18px;
  font-weight:500;
  color:#111;
  word-break:break-word;
}
.center{
  text-align:center;
}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <img src="/logo.jpeg" alt="${htmlEscape(BUSINESS_NAME)}">
  </div>
  ${body}
  <div class="footer-links">
    <a href="/">עמוד העסק</a>
    <a href="/cancel-policy">מדיניות ביטול</a>
  </div>
</div>
</body>
</html>
`;
}

function renderBusinessInfoPage() {
  return renderLayout({
    title: BUSINESS_NAME,
    body: `
      <h1 class="center">${htmlEscape(BUSINESS_NAME)}</h1>
      <p class="center">עמוד זה משמש לתשלום עבור הזמנות שבוצעו טלפונית או ישירות מול בית העסק.</p>

      <div class="notice">
        זהו עמוד תשלום להזמנות טלפוניות, ולא חנות אינטרנטית עם סל קניות.
      </div>

      <ul class="info-list">
        <li><strong>שם העסק:</strong> ${htmlEscape(BUSINESS_NAME)}</li>
        <li><strong>טלפון בית העסק:</strong> ${htmlEscape(BUSINESS_PHONE)}</li>
        <li><strong>כתובת העסק:</strong> ${htmlEscape(BUSINESS_ADDRESS)}</li>
        <li><strong>שירותים/מוצרים:</strong> מכירת מזון והזמנות טלפוניות מבית העסק, לרבות תשלום מרחוק עבור הזמנה קיימת.</li>
      </ul>

      <div class="notice">
        <strong>ביטול הזמנה:</strong><br>
        יש להתקשר ל-${htmlEscape(BUSINESS_CANCEL_PHONE)} שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_1)}.<br>
        אם אין מענה אחרי חצי דקה, יש לעבור לשלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_2)}.
      </div>

      <div class="notice">
        <strong>בדיקת חיובים כפולים:</strong><br>
        יש לשלוח צילום מסך לוואטסאפ:
        <a href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">052-415-0000</a>
      </div>

      <a class="btn primary" href="/pay/1234/89">מעבר לעמוד תשלום לדוגמה</a>
      <a class="btn green" href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">לשליחת צילום מסך בוואטסאפ</a>

      <p class="small">
        לבירורים, שינוי הזמנה או בקשת סיוע ניתן ליצור קשר ישירות עם בית העסק.
      </p>
    `
  });
}

function renderCancelPolicyPage() {
  return renderLayout({
    title: "מדיניות ביטול",
    body: `
      <h1 class="center">מדיניות ביטול עסקה</h1>

      <p>
        לבקשת ביטול, שינוי הזמנה או בירור, יש להתקשר ל<strong>${htmlEscape(BUSINESS_CANCEL_PHONE)}</strong> שלוחה <strong>${htmlEscape(BUSINESS_CANCEL_EXT_1)}</strong>.
        אם אין מענה אחרי חצי דקה, יש לעבור לשלוחה <strong>${htmlEscape(BUSINESS_CANCEL_EXT_2)}</strong>.
      </p>

      <p>
        בקשות לביטול עסקה, שינוי הזמנה, החזר או זיכוי ייבדקו ויטופלו בהתאם להוראות הדין החל על העסקה,
        סוג המוצר או השירות, ומועד הבקשה ביחס למועד הכנת ההזמנה או מסירתה.
      </p>

      <p>
        בעסקאות הנוגעות להזמנת מזון שהוכנה במיוחד עבור הלקוח או שהכנתה כבר החלה,
        ייתכנו מגבלות על ביטול או החזר, בכפוף לדין.
      </p>

      <p>
        במקרה של חיוב כפול או צורך בבדיקת חיוב, יש לשלוח צילום מסך לוואטסאפ:
        <a href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">052-415-0000</a>.
      </p>

      <p>
        פרטי העסק: ${htmlEscape(BUSINESS_NAME)}, ${htmlEscape(BUSINESS_ADDRESS)}, טלפון: ${htmlEscape(BUSINESS_PHONE)}.
      </p>

      <a class="btn primary" href="/pay/1234/89">מעבר לעמוד תשלום לדוגמה</a>
      <a class="btn green" href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">לשליחת צילום מסך בוואטסאפ</a>
    `
  });
}

function renderPaymentPage({ orderId, amount, phone }) {
  return renderLayout({
    title: "תשלום להזמנה",
    body: `
      <h1 class="center">תשלום להזמנה #${htmlEscape(orderId)}</h1>

      <p class="center small">
        תשלום זה מיועד להזמנה שבוצעה טלפונית או ישירות מול בית העסק.
      </p>

      <form method="POST" action="/create-session">
        <input type="hidden" name="orderId" value="${htmlEscape(orderId)}">

        <label>סכום לתשלום</label>
        <input name="amount" value="${htmlEscape(amount)}" inputmode="decimal" required>

        <label>שם מלא</label>
        <input name="name" autocomplete="name" required>

        <label>טלפון</label>
        <input name="phone" value="${htmlEscape(phone)}" inputmode="tel" autocomplete="tel" required>

        <button type="submit">מעבר לתשלום</button>
      </form>

      <div class="notice">
        <strong>פרטי העסק:</strong><br>
        ${htmlEscape(BUSINESS_NAME)}<br>
        ${htmlEscape(BUSINESS_PHONE)}<br>
        ${htmlEscape(BUSINESS_ADDRESS)}
      </div>

      <div class="notice">
        <strong>לביטול:</strong><br>
        התקשרו ל-${htmlEscape(BUSINESS_CANCEL_PHONE)} שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_1)}.<br>
        אם אין מענה אחרי חצי דקה, עברו לשלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_2)}.
      </div>

      <div class="notice">
        <strong>לחיוב כפול / בדיקת חיוב:</strong><br>
        שלחו צילום מסך לוואטסאפ:
        <a href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">052-415-0000</a>
      </div>

      <a class="btn green" href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">לשליחת צילום מסך בוואטסאפ</a>
    `
  });
}

function renderSuccess({ receipt, orderIdFromUrl }) {
  const customerName = String(receipt.customerName || "").trim();
  const effectiveOrderId = cleanOrderId(receipt.orderId || orderIdFromUrl || "");
  const phone = String(receipt.phone || "").trim();

  const amount =
    receipt.amount !== undefined &&
    receipt.amount !== null &&
    String(receipt.amount).trim() !== ""
      ? String(receipt.amount).trim()
      : "";

  const approval = String(receipt.approval || "").trim();
  const transactionDateTime = String(receipt.transactionDateTimeFormatted || "").trim();

  function block(label, value) {
    if (!value || String(value).trim() === "") return "";
    return `
      <div class="field-block">
        <div class="field-label">${htmlEscape(label)}</div>
        <div class="field-value">${htmlEscape(value)}</div>
      </div>
    `;
  }

  return renderLayout({
    title: "אישור תשלום",
    body: `
      <h1 class="center">אישור תשלום</h1>
      <p class="center" style="color:#1a7f37;font-weight:800;">התשלום עבר בהצלחה ✅</p>

      ${block("שם המשלם", customerName)}
      ${block("מספר הזמנה", effectiveOrderId)}
      ${block("טלפון", phone)}
      ${block("סכום העסקה", amount ? amount + " ₪" : "")}
      ${block("תאריך ושעת העסקה", transactionDateTime)}
      ${block("מספר אישור", approval)}

      <div class="notice">
        אם נראה שבוצע חיוב כפול, יש לשלוח צילום מסך לוואטסאפ:
        <a href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">052-415-0000</a>
      </div>
    `
  });
}

function renderCancelPage() {
  return renderLayout({
    title: "התשלום בוטל",
    body: `
      <h1 class="center">התשלום בוטל</h1>
      <p class="center">לא בוצע חיוב. ניתן לבצע ניסיון נוסף במידת הצורך.</p>

      <div class="notice">
        לביטול או בירור: ${htmlEscape(BUSINESS_CANCEL_PHONE)} שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_1)}<br>
        אם אין מענה אחרי חצי דקה, שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_2)}
      </div>

      <a class="btn primary" href="/pay/1234/89">מעבר לעמוד תשלום לדוגמה</a>
      <a class="btn green" href="${htmlEscape(BUSINESS_WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer">לשליחת צילום מסך בוואטסאפ</a>
    `
  });
}

async function handleZcCallback(req, res) {
  try {
    const body = req.body || {};

    const uniqueId = String(body.UniqueID || "").trim();
    const orderId = cleanOrderId(body.AdditionalText || "");
    const existing = getReceipt(uniqueId, orderId) || {};

    if (!hasRealApproval(body)) {
      console.log("zc-callback received without real approval, skipping sheet write");
      return res.send("OK");
    }

    const paymentDate = formatIsraelDateTime(new Date());

    const receipt = {
      ...existing,
      uniqueId: uniqueId || existing.uniqueId || "",
      orderId: cleanOrderId(orderId || existing.orderId || ""),
      approval: String(body.ApprovalNumber || existing.approval || "").trim(),
      transactionDateTimeFormatted: paymentDate
    };

    saveReceipt(receipt.uniqueId, receipt.orderId, receipt);

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
      saveReceipt(receipt.uniqueId, receipt.orderId, receipt);
    }
  } catch (err) {
    console.error("zc-callback error:", err);
  }

  res.send("OK");
}

app.get("/", (req, res) => {
  res.send(renderBusinessInfoPage());
});

app.get("/business-info", (req, res) => {
  res.send(renderBusinessInfoPage());
});

app.get("/cancel-policy", (req, res) => {
  res.send(renderCancelPolicyPage());
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId) {
    return res.status(400).send("מספר הזמנה לא תקין");
  }

  res.send(renderPaymentPage({ orderId, amount, phone }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId) {
    return res.status(400).send("מספר הזמנה לא תקין");
  }

  res.send(renderPaymentPage({ orderId, amount, phone: "" }));
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
    res.status(500).send("שגיאה ביצירת תשלום");
  }
});

app.all("/zc-callback", handleZcCallback);

app.get("/payment-success", async (req, res) => {
  try {
    const orderIdFromUrl = cleanOrderId(req.query.orderId || "");
    const uniqueId = String(req.query.uniqueId || "").trim();

    let receipt = null;

    if (uniqueId) {
      receipt = await findPaymentByTokenInSheet(uniqueId);
    }

    if (!receipt) {
      const existing = getReceipt(uniqueId, orderIdFromUrl) || {};

      receipt = {
        uniqueId: uniqueId || existing.uniqueId || "",
        orderId: cleanOrderId(existing.orderId || orderIdFromUrl || ""),
        customerName: String(existing.customerName || "").trim(),
        phone: String(existing.phone || "").trim(),
        amount:
          existing.amount !== undefined && existing.amount !== null
            ? String(existing.amount).trim()
            : "",
        approval: String(existing.approval || "").trim(),
        transactionDateTimeFormatted: String(existing.transactionDateTimeFormatted || "").trim()
      };
    }

    res.send(renderSuccess({ receipt, orderIdFromUrl }));
  } catch (err) {
    console.error("payment-success error:", err);
    res.status(500).send("שגיאה בהצגת אישור התשלום");
  }
});

app.get("/payment-cancel", (req, res) => {
  res.send(renderCancelPage());
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
