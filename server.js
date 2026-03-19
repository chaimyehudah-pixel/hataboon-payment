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
const BUSINESS_PHONE_DISPLAY = "029605556";
const BUSINESS_ADDRESS = "א.התעשייה קריית-ארבע - חברון";
const BUSINESS_STREET = "רחוב משה בוסאני לוי 11";
const BUSINESS_FULL_ADDRESS = `${BUSINESS_ADDRESS}, ${BUSINESS_STREET}`;
const BUSINESS_CANCEL_PHONE_DISPLAY = "029605556";
const BUSINESS_CANCEL_EXT_1 = "4";
const BUSINESS_CANCEL_EXT_2 = "7";
const BUSINESS_WHATSAPP_URL = "https://wa.me/972524150000";
const BUSINESS_WHATSAPP_DISPLAY = "052-415-0000";
const PAYMENT_ENTRY_URL = "https://hataboon-payment-production.up.railway.app/pay/0/0";
const BUSINESS_ID_LABEL = "ע.מ. 021957303";
const BUSINESS_WEBSITE_URL = "https://www.hataboon.co.il";
const BUSINESS_WEBSITE_DISPLAY = "www.hataboon.co.il";
const PAYMENT_HEADER_INLINE_TEXT = "הטאבון, פיצרייה ובית קפה";

const receiptsByUniqueId = new Map();
const receiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function cleanDigits(v) {
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
  let d = cleanDigits(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);
  return d.slice(0, 12);
}

function normalizePhoneLocal(phoneRaw) {
  let d = cleanDigits(phoneRaw);
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("972") && d.length >= 12) return "0" + d.slice(3, 12);
  if (d.startsWith("0")) return d.slice(0, 10);
  return d.slice(0, 10);
}

function parseStoredIsraelDateTime(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    return { date: "", time: "", combined: "" };
  }

  const [, day, month, year, hour, minute, second] = m;

  return {
    date: `${day}.${month}.${year}`,
    time: `${hour}:${minute}:${second}`,
    combined: `${day}.${month}.${year}, ${hour}:${minute}:${second}`
  };
}

function formatIsraelDateTimeParts(dateValue) {
  if (typeof dateValue === "string") {
    const parsed = parseStoredIsraelDateTime(dateValue);
    if (parsed.combined) return parsed;
  }

  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) {
    return { date: "", time: "", combined: "" };
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");

  return {
    date: `${day}.${month}.${year}`,
    time: `${hour}:${minute}:${second}`,
    combined: `${day}.${month}.${year}, ${hour}:${minute}:${second}`
  };
}

function formatIsraelDateTime(dateValue) {
  return formatIsraelDateTimeParts(dateValue).combined;
}

function saveReceipt(uniqueId, orderId, receipt) {
  const finalUniqueId = String(uniqueId || receipt.uniqueId || "").trim();
  const finalOrderId = cleanOrderId(orderId || receipt.orderId || "");

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

async function getNextReceiptSerial() {
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) {
    return String(Date.now());
  }

  const sheets = createSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:J`
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return "1";

  let maxSerial = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const serial = Number(String(row[8] || "").trim());
    if (Number.isFinite(serial) && serial > maxSerial) {
      maxSerial = serial;
    }
  }

  return String(maxSerial + 1);
}

async function appendPaidPaymentToSheet({
  token,
  orderId,
  name,
  phone,
  amount,
  approvalNumber,
  paymentDate,
  receiptSerial,
  paymentLast4
}) {
  if (!GOOGLE_SERVICE_ACCOUNT || !GOOGLE_SHEET_ID) return;

  const sheets = createSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
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
        "no",
        String(receiptSerial || ""),
        String(paymentLast4 || "")
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
    range: `${SHEET_NAME}!A:J`
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
        handled: String(row[7] || "").trim(),
        receiptSerial: String(row[8] || "").trim(),
        paymentLast4: String(row[9] || "").trim()
      };
    }
  }

  return null;
}

function hasRealApproval(body) {
  return String(body?.ApprovalNumber || "").trim() !== "";
}

function parsePositiveAmount(value) {
  const normalized = String(value || "").replace(",", ".").trim();
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Number(amount.toFixed(2));
}

function renderWhatsAppLink() {
  return `<a class="nowrap-text" href="${BUSINESS_WHATSAPP_URL}" target="_blank" rel="noopener noreferrer">${htmlEscape(BUSINESS_WHATSAPP_DISPLAY)}</a>`;
}

function renderWebsiteLink() {
  return `<a class="nowrap-text" href="${BUSINESS_WEBSITE_URL}" target="_blank" rel="noopener noreferrer">${htmlEscape(BUSINESS_WEBSITE_DISPLAY)}</a>`;
}

function extractPaymentLast4(body) {
  const candidates = [
    body?.CardMask,
    body?.CardNum,
    body?.CardNumber,
    body?.Pan,
    body?.PAN,
    body?.CreditCard,
    body?.TokenizedCardMask
  ];

  for (const value of candidates) {
    const digits = cleanDigits(String(value || ""));
    if (digits.length >= 4) {
      return digits.slice(-4);
    }
  }

  return "";
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
    appendedToSheet: false,
    receiptSerial: "",
    paymentLast4: ""
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
  background:#efefef;
  margin:0;
  padding:18px;
  color:#111;
}
*{
  box-sizing:border-box;
}
.card{
  max-width:760px;
  width:100%;
  margin:0 auto;
  background:#f7f7f7;
  border-radius:34px;
  padding:22px 22px 28px;
  box-shadow:0 0 0 1px rgba(175,137,79,0.10) inset;
}
.top-area{
  position:relative;
  min-height:140px;
  margin-bottom:8px;
}
.logo{
  text-align:center;
  margin:0 auto 6px;
}
.logo img{
  max-width:230px;
  width:100%;
  height:auto;
}
.address-line{
  text-align:center;
  font-size:14px;
  color:#5b4822;
  margin:0 auto 0;
  max-width:520px;
  border-top:2px solid #e4d1a0;
  border-bottom:2px solid #e4d1a0;
  padding:3px 8px;
}
.inline-business-bar{
  text-align:center;
  font-size:14px;
  color:#5b4822;
  margin:8px auto 0;
  max-width:680px;
  line-height:1.5;
  font-weight:600;
}
.inline-business-bar .phone-emoji{
  margin:0 4px;
}
.inline-business-bar .inline-phone{
  white-space:nowrap;
  display:inline-block;
  direction:ltr;
  unicode-bidi:isolate;
}
.inline-datetime-bar{
  text-align:center;
  font-size:14px;
  color:#5b4822;
  margin:4px auto 0;
  max-width:680px;
  line-height:1.5;
  font-weight:700;
}
.inline-datetime-bar .inline-date,
.inline-datetime-bar .inline-time{
  white-space:nowrap;
  display:inline-block;
  direction:ltr;
  unicode-bidi:isolate;
}
h1{
  margin:0 0 8px;
  text-align:center;
  font-size:28px;
  line-height:1.2;
}
p{
  line-height:1.55;
}
.subtitle{
  text-align:center;
  font-size:16px;
  color:#333;
  margin:8px 0 24px;
}
.notice{
  background:#f6f0df;
  border:1px solid #e2c978;
  padding:14px 18px;
  border-radius:14px;
  margin:14px 0;
  line-height:1.7;
}
.info-list{
  margin:0;
  padding:0;
  list-style:none;
}
.info-list li{
  margin:12px 0;
  padding:14px 16px;
  background:#f4f4f4;
  border:1px solid #dddddd;
  border-radius:12px;
  line-height:1.65;
}
label{
  font-weight:700;
  display:block;
  margin:18px 0 8px;
  font-size:16px;
}
input{
  width:100%;
  padding:14px 16px;
  border-radius:14px;
  border:1px solid #d2d2d2;
  background:#fafafa;
  font-size:16px;
  outline:none;
}
input:focus{
  border-color:#b79b5b;
}
button,
a.btn{
  width:100%;
  display:inline-block;
  text-align:center;
  text-decoration:none;
  border-radius:16px;
  padding:16px 18px;
  font-size:16px;
  font-weight:700;
  margin-top:16px;
  cursor:pointer;
}
button,
a.btn.primary{
  border:0;
  background:#d41108;
  color:#fff;
}
a.btn.secondary{
  border:0;
  background:#4159d1;
  color:#fff;
}
.footer-buttons{
  display:flex;
  flex-direction:column;
  gap:14px;
  margin-top:24px;
}
.small-center{
  text-align:center;
  color:#444;
  font-size:14px;
  margin:6px 0 0;
}
.field-block{
  padding:14px 0 12px;
  border-top:1px solid #e2e2e2;
}
.field-label{
  font-size:14px;
  color:#444;
  margin-bottom:4px;
  font-weight:700;
}
.field-value{
  font-size:18px;
  font-weight:700;
  color:#111;
}
.receipt-wrap{
  max-width:700px;
  margin:0 auto;
}
.receipt-top-details{
  width:100%;
  margin:8px 0 28px;
  text-align:right;
}
.receipt-top-row{
  margin-bottom:8px;
}
.receipt-top-label{
  display:block;
  font-size:14px;
  color:#444;
  font-weight:700;
  margin-bottom:4px;
}
.receipt-top-value{
  display:block;
  font-size:18px;
  color:#111;
  font-weight:800;
}
.receipt-header{
  text-align:center;
  margin:6px 0 26px;
}
.receipt-title{
  font-size:28px;
  font-weight:800;
  color:#111;
  margin:0 0 8px;
}
.success-title{
  text-align:center;
  color:#5a9c55;
  font-size:18px;
  font-weight:800;
  margin:0 0 10px;
}
.receipt-id{
  text-align:center;
  font-size:15px;
  color:#555;
  margin:0 0 8px;
}
.receipt-serial{
  text-align:center;
  font-size:16px;
  color:#333;
  margin:0 0 24px;
  font-weight:700;
}
.print-btn{
  width:100%;
  display:block;
  text-align:center;
  text-decoration:none;
  border-radius:16px;
  padding:16px 18px;
  font-size:16px;
  font-weight:700;
  margin-top:18px;
  cursor:pointer;
  border:0;
  background:#4159d1;
  color:#fff;
}
.nowrap-text{
  white-space:nowrap;
  display:inline-block;
  word-break:normal;
  overflow-wrap:normal;
  direction:ltr;
  unicode-bidi:isolate;
}
@media print{
  body{
    background:#fff;
    padding:0;
  }
  .card{
    max-width:none;
    width:100%;
    margin:0;
    border-radius:0;
    box-shadow:none;
    padding:0;
    background:#fff;
  }
  .footer-buttons,
  .print-btn{
    display:none !important;
  }
}
@media (max-width: 640px){
  body{
    padding:10px;
  }
  .card{
    padding:16px 14px 22px;
    border-radius:28px;
  }
  .top-area{
    min-height:125px;
  }
  .inline-business-bar,
  .inline-datetime-bar{
    font-size:13px;
    max-width:100%;
  }
  h1,
  .receipt-title{
    font-size:24px;
  }
  .logo img{
    max-width:180px;
  }
  .address-line{
    font-size:13px;
    max-width:100%;
  }
}
</style>
<script>
async function shareCurrentPage() {
  const url = window.location.href;

  try {
    if (navigator.share) {
      await navigator.share({
        title: document.title || "קישור לדף",
        url
      });
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      alert("כתובת הדף הועתקה ללוח");
      return;
    }

    const tempInput = document.createElement("input");
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
    alert("כתובת הדף הועתקה ללוח");
  } catch (err) {
    alert("לא ניתן היה לשתף את כתובת הדף");
  }
}
</script>
</head>
<body>
<div class="card">
  ${body}
</div>
</body>
</html>
`;
}

function renderHeaderMini(options = {}) {
  const {
    showDateTimeLine = false,
    dateValue = new Date()
  } = options;

  const dt = formatIsraelDateTimeParts(dateValue);

  return `
    <div class="top-area">
      <div class="logo">
        <img src="/logo.jpeg" alt="${htmlEscape(BUSINESS_NAME)}">
      </div>
      <div class="address-line">
        ${htmlEscape(BUSINESS_STREET)} &nbsp;&nbsp; ${htmlEscape(BUSINESS_ADDRESS)}
      </div>
      <div class="inline-business-bar">
        ${htmlEscape(PAYMENT_HEADER_INLINE_TEXT)}
        <span class="phone-emoji">☎</span>
        <span class="inline-phone">${htmlEscape(BUSINESS_PHONE_DISPLAY)}</span>
      </div>
      ${showDateTimeLine ? `
      <div class="inline-datetime-bar">
        <span class="inline-date">${htmlEscape(dt.date)}</span>
        <span class="inline-time">${htmlEscape(dt.time)}</span>
      </div>
      ` : ""}
    </div>
  `;
}

function renderBusinessInfoPage() {
  return renderLayout({
    title: BUSINESS_NAME,
    body: `
      ${renderHeaderMini()}
      <h1>${htmlEscape(BUSINESS_NAME)}</h1>
      <div class="subtitle">
        אתר זה נועד עבור סליקת אשראי וביצוע תשלום עבור הזמנות שבוצעו טלפונית או ישירות מבית העסק
      </div>

      <div class="notice">
        זהו עמוד תשלום בלבד עבור הזמנות טלפונית ולא חנות אינטרנטית.<br>
        למעבר לחנות האינטרנטית המלאה ולצפייה בתפריט: ${renderWebsiteLink()}
      </div>

      <ul class="info-list">
        <li><strong>שם העסק:</strong> ${htmlEscape(BUSINESS_NAME)}</li>
        <li><strong>עוסק מורשה:</strong> ${htmlEscape(BUSINESS_ID_LABEL)}</li>
        <li><strong>טלפון בית העסק:</strong> <span class="nowrap-text">${htmlEscape(BUSINESS_PHONE_DISPLAY)}</span></li>
        <li><strong>כתובת העסק:</strong> ${htmlEscape(BUSINESS_FULL_ADDRESS)}</li>
        <li><strong>שירותים / מוצרים:</strong> פיצרייה ובית קפה באיסוף עצמי, ישיבה במקום, ומשלוחים.</li>
      </ul>

      <div class="notice">
        <strong>הנהלת חשבונות</strong><br>
        הנהלת חשבונות זמינים לכם בוואטסאפ: ${renderWhatsAppLink()}
      </div>

      <div class="small-center">
        לבירורים, שינוי הזמנה או בקשת סיוע ניתן ליצור קשר עם בית העסק:
        <span class="nowrap-text">${htmlEscape(BUSINESS_CANCEL_PHONE_DISPLAY)}</span>
        שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_1)}
      </div>

      <div class="footer-buttons">
        <a class="btn secondary" href="/cancel-policy">מדיניות ביטולים וברורי עסקאות</a>
      </div>
    `
  });
}

function renderCancelPolicyPage() {
  return renderLayout({
    title: "מדיניות ביטולים וברורי עסקאות",
    body: `
      ${renderHeaderMini()}
      <h1>מדיניות ביטולים וברורי עסקאות</h1>

      <p style="font-size:18px; line-height:1.8; text-align:right;">
        לבקשת ביטול, שינוי הזמנה או בירור, יש להתקשר ל<strong><span class="nowrap-text">${htmlEscape(BUSINESS_CANCEL_PHONE_DISPLAY)}</span></strong>
        שלוחה <strong>${htmlEscape(BUSINESS_CANCEL_EXT_1)}</strong>.
        אם אין מענה אחרי חצי דקה, יש לעבור לשלוחה <strong>${htmlEscape(BUSINESS_CANCEL_EXT_2)}</strong>.
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:right;">
        בקשות לביטול עסקה, שינוי הזמנה, החזר או זיכוי ייבדקו ויטופלו בהתאם להוראות הדין החל על העסקה,
        סוג המוצר או השירות, ומועד הבקשה ביחס למועד הכנת ההזמנה או מסירתה.
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:right;">
        בעסקאות הנוגעות להזמנת מזון שהוכנה במיוחד עבור הלקוח או שהכנתה כבר החלה, ייתכנו מגבלות על ביטול או
        החזר, בכפוף לדין.
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:right;">
        במקרה של צורך בבירור כספי, ניתן לפנות גם לוואטסאפ:
        ${renderWhatsAppLink()}
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:right;">
        פרטי העסק: ${htmlEscape(BUSINESS_NAME)}, ${htmlEscape(BUSINESS_ID_LABEL)}, ${htmlEscape(BUSINESS_FULL_ADDRESS)}, טלפון:
        <span class="nowrap-text">${htmlEscape(BUSINESS_PHONE_DISPLAY)}</span>.
      </p>

      <div class="footer-buttons">
        <a class="btn secondary" href="/">עמוד העסק</a>
      </div>
    `
  });
}

function renderPaymentPage({ orderId, amount, phone }) {
  return renderLayout({
    title: "תשלום להזמנה",
    body: `
      ${renderHeaderMini()}
      <h1>תשלום להזמנה #${htmlEscape(orderId)}</h1>
      <div class="subtitle">
        תשלום זה מיועד להזמנה שבוצעה טלפונית או ישירות מול בית העסק.
      </div>

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

      <div class="footer-buttons">
        <a class="btn secondary" href="/">עמוד העסק</a>
        <a class="btn secondary" href="/cancel-policy">מדיניות ביטולים וברורי עסקאות</a>
      </div>
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
  const receiptSerial = String(receipt.receiptSerial || "").trim();
  const paymentLast4 = String(receipt.paymentLast4 || "").trim();

  function block(label, value, extraClass = "") {
    if (!value || String(value).trim() === "") return "";
    return `
      <div class="field-block">
        <div class="field-label">${htmlEscape(label)}</div>
        <div class="field-value ${extraClass}">${htmlEscape(value)}</div>
      </div>
    `;
  }

  return renderLayout({
    title: "אישור תשלום",
    body: `
      ${renderHeaderMini({
        showDateTimeLine: true,
        dateValue: transactionDateTime || new Date()
      })}

      <div class="receipt-wrap">
        <div class="receipt-top-details">
          <div class="receipt-top-row">
            <span class="receipt-top-label">לכבוד:</span>
            <span class="receipt-top-value">${htmlEscape(customerName)}</span>
          </div>
          <div class="receipt-top-row">
            <span class="receipt-top-label">טלפון:</span>
            <span class="receipt-top-value nowrap-text">${htmlEscape(phone)}</span>
          </div>
        </div>

        <div class="receipt-header">
          <div class="receipt-title">אישור תשלום</div>
          <div class="success-title">✅ התשלום עבר בהצלחה</div>
          <div class="receipt-id">${htmlEscape(BUSINESS_ID_LABEL)}</div>
          ${receiptSerial ? `<div class="receipt-serial">מספר קבלה: ${htmlEscape(receiptSerial)}</div>` : ""}
        </div>

        ${block("תשלום עבור הזמנה:", effectiveOrderId)}
        ${block("סכום העסקה:", amount ? amount + " ₪" : "")}
        ${block("מספר אישור מחברת האשראי:", approval)}
        ${block("4 ספרות אחרונות של אמצעי התשלום:", paymentLast4, "nowrap-text")}

        <button type="button" class="print-btn" onclick="window.print()">הורדת אישור PDF</button>
        <button type="button" class="print-btn" onclick="shareCurrentPage()">שיתוף כתובת דף האינטרנט</button>

        <div class="footer-buttons">
          <a class="btn secondary" href="/">עמוד העסק</a>
          <a class="btn secondary" href="/cancel-policy">מדיניות ביטולים וברורים כספיים</a>
        </div>
      </div>
    `
  });
}

function renderCancelPage() {
  return renderLayout({
    title: "התשלום בוטל",
    body: `
      ${renderHeaderMini()}
      <h1>התשלום בוטל</h1>
      <div class="subtitle">לא בוצע חיוב. ניתן לבצע ניסיון נוסף במידת הצורך.</div>

      <div class="notice">
        לביטול או בירור יש להתקשר ל-<span class="nowrap-text">${htmlEscape(BUSINESS_CANCEL_PHONE_DISPLAY)}</span>
        שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_1)}.
        אם אין מענה אחרי חצי דקה, שלוחה ${htmlEscape(BUSINESS_CANCEL_EXT_2)}.
      </div>

      <div class="footer-buttons">
        <a class="btn secondary" href="/">עמוד העסק</a>
        <a class="btn secondary" href="/cancel-policy">מדיניות ביטולים וברורים כספיים</a>
      </div>
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
    const paymentLast4 = extractPaymentLast4(body);
    let receiptSerial = String(existing.receiptSerial || "").trim();

    if (!receiptSerial) {
      receiptSerial = await getNextReceiptSerial();
    }

    const receipt = {
      ...existing,
      uniqueId: uniqueId || existing.uniqueId || "",
      orderId: cleanOrderId(orderId || existing.orderId || ""),
      approval: String(body.ApprovalNumber || existing.approval || "").trim(),
      transactionDateTimeFormatted: paymentDate,
      receiptSerial,
      paymentLast4
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
        paymentDate,
        receiptSerial: receipt.receiptSerial || "",
        paymentLast4: receipt.paymentLast4 || ""
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

  if (!orderId && orderId !== "0") {
    return res.status(400).send("מספר הזמנה לא תקין");
  }

  res.send(renderPaymentPage({ orderId: orderId || "0", amount, phone }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId && orderId !== "0") {
    return res.status(400).send("מספר הזמנה לא תקין");
  }

  res.send(renderPaymentPage({ orderId: orderId || "0", amount, phone: "" }));
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
        transactionDateTimeFormatted: String(existing.transactionDateTimeFormatted || "").trim(),
        receiptSerial: String(existing.receiptSerial || "").trim(),
        paymentLast4: String(existing.paymentLast4 || "").trim()
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
