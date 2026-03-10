const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = String(process.env.BASE_URL || "").trim();
const ZC_KEY = String(process.env.ZC_KEY || "").trim();
const ZC_TERMINAL = String(process.env.ZC_TERMINAL || "").trim();
const ZC_PASSWORD = String(process.env.ZC_PASSWORD || "").trim();

const OTP_SERVER_URL = String(process.env.OTP_SERVER_URL || "").trim();
const OTP_SIGNING_SECRET = String(process.env.OTP_SIGNING_SECRET || "").trim();

const FLOW_TTL_MINUTES = 60;
const RECEIPT_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const RECEIPT_TERMINAL_NAME = process.env.RECEIPT_TERMINAL_NAME || "הטאבון";
const RECEIPT_TERMINAL_NUMBER = process.env.RECEIPT_TERMINAL_NUMBER || "2666131";
const RECEIPT_SOFTWARE_VERSION = process.env.RECEIPT_SOFTWARE_VERSION || "WEB001630i";
const RECEIPT_MERCHANT_NUMBER = process.env.RECEIPT_MERCHANT_NUMBER || "5927439";
const RECEIPT_DEFAULT_EXECUTION_METHOD = process.env.RECEIPT_DEFAULT_EXECUTION_METHOD || "עסקה טלפונית";
const RECEIPT_DEFAULT_APPROVER = process.env.RECEIPT_DEFAULT_APPROVER || "חברה";
const RECEIPT_DEFAULT_TRANSACTION_TYPE = process.env.RECEIPT_DEFAULT_TRANSACTION_TYPE || "חובה";
const RECEIPT_DEFAULT_CREDIT_TYPE = process.env.RECEIPT_DEFAULT_CREDIT_TYPE || "רגיל";
const RECEIPT_DEFAULT_CURRENCY = process.env.RECEIPT_DEFAULT_CURRENCY || `ש"ח`;

const otpFlows = new Map();
const paymentReceiptsByUniqueId = new Map();
const paymentReceiptsByOrderId = new Map();

function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function toAmountNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function htmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function otpConfigOk() {
  return Boolean(OTP_SERVER_URL) && Boolean(OTP_SIGNING_SECRET);
}

function otpBaseUrl() {
  return OTP_SERVER_URL.replace(/\/+$/g, "");
}

function randomId() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizePhoneDigits(phoneRaw) {
  let d = String(phoneRaw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);
  if (d.startsWith("972") && d.length >= 12) return d;
  return d;
}

function normalizePhoneLocal(phoneRaw) {
  let d = String(phoneRaw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00972")) d = d.slice(2);
  if (d.startsWith("972") && d.length >= 12) return "0" + d.slice(3, 12);
  if (d.startsWith("0") && d.length >= 10) return d.slice(0, 10);
  return d;
}

function hmacSign(payloadObj) {
  const payloadJson = JSON.stringify(payloadObj);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", OTP_SIGNING_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

function hmacVerify(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  const expected = crypto
    .createHmac("sha256", OTP_SIGNING_SECRET)
    .update(payloadB64)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const obj = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!obj || !obj.exp || Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

function cleanupOldFlows() {
  const now = Date.now();
  for (const [flowId, flow] of otpFlows.entries()) {
    if (!flow || !flow.createdAt || now - flow.createdAt > FLOW_TTL_MINUTES * 60 * 1000) {
      otpFlows.delete(flowId);
    }
  }
}

function getFlow(flowId) {
  cleanupOldFlows();
  return otpFlows.get(flowId) || null;
}

function setFlow(flowId, flow) {
  otpFlows.set(flowId, flow);
}

function findActiveFlow(orderId, phone) {
  cleanupOldFlows();
  const cleanId = cleanOrderId(orderId);
  const cleanPhone = String(phone || "").trim();

  for (const [flowId, flow] of otpFlows.entries()) {
    if (!flow) continue;
    if (flow.orderId !== cleanId) continue;
    if (String(flow.phone || "").trim() !== cleanPhone) continue;
    if (!flow.otpExpiresAt) continue;
    if (Date.now() >= flow.otpExpiresAt) continue;
    return { flowId, flow };
  }

  return null;
}

function cleanupOldReceipts() {
  const now = Date.now();
  for (const [k, v] of paymentReceiptsByUniqueId.entries()) {
    if (!v || !v.createdAt || now - v.createdAt > RECEIPT_CACHE_TTL_MS) {
      paymentReceiptsByUniqueId.delete(k);
    }
  }
  for (const [k, v] of paymentReceiptsByOrderId.entries()) {
    if (!v || !v.createdAt || now - v.createdAt > RECEIPT_CACHE_TTL_MS) {
      paymentReceiptsByOrderId.delete(k);
    }
  }
}

function saveReceipt(uniqueId, orderId, receipt) {
  const rec = {
    ...receipt,
    uniqueId: uniqueId || receipt.uniqueId || "",
    orderId: orderId || receipt.orderId || "",
    createdAt: receipt.createdAt || Date.now(),
  };
  if (rec.uniqueId) paymentReceiptsByUniqueId.set(rec.uniqueId, rec);
  if (rec.orderId) paymentReceiptsByOrderId.set(rec.orderId, rec);
}

function getReceipt(uniqueId, orderId) {
  cleanupOldReceipts();
  if (uniqueId && paymentReceiptsByUniqueId.has(uniqueId)) {
    return paymentReceiptsByUniqueId.get(uniqueId);
  }
  if (orderId && paymentReceiptsByOrderId.has(orderId)) {
    return paymentReceiptsByOrderId.get(orderId);
  }
  return null;
}

function deepGetFirst(source, keys) {
  if (!source || typeof source !== "object") return "";
  const wanted = keys.map((k) => String(k).toLowerCase());
  const queue = [source];

  while (queue.length) {
    const obj = queue.shift();
    if (!obj || typeof obj !== "object") continue;

    for (const [k, v] of Object.entries(obj)) {
      if (wanted.includes(String(k).toLowerCase()) && v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v);
      }
    }

    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") queue.push(v);
    }
  }

  return "";
}

function formatDateTimeValue(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(-2);
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${yy} ${hh}:${mi}`;
    }
  }

  if (/^\d{14}$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    const hh = s.slice(8, 10);
    const mi = s.slice(10, 12);
    return `${dd}/${mm}/${yyyy.slice(-2)} ${hh}:${mi}`;
  }

  return s;
}

function formatAmountValue(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const num = Number(s);
  if (Number.isFinite(num)) return num.toFixed(2);
  return s;
}

function formatCurrencyValue(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return RECEIPT_DEFAULT_CURRENCY;
  if (s === "ILS") return RECEIPT_DEFAULT_CURRENCY;
  return String(v);
}

function formatCreditTypeValue(v) {
  const s = String(v || "").trim();
  if (!s) return RECEIPT_DEFAULT_CREDIT_TYPE;
  if (s === "1") return "רגיל";
  if (/regular/i.test(s)) return "רגיל";
  return s;
}

function normalizeReceiptData(rawBody, fallback = {}) {
  const body = rawBody || {};

  const receipt = {
    customerName:
      deepGetFirst(body, ["CustomerName", "customerName", "Name", "name"]) ||
      fallback.customerName ||
      "",
    phone:
      normalizePhoneLocal(
        deepGetFirst(body, ["PhoneNumber", "phoneNumber", "Phone", "phone"])
      ) ||
      fallback.phone ||
      "",
    orderId:
      cleanOrderId(
        deepGetFirst(body, ["AdditionalText", "additionalText", "OrderId", "orderId"])
      ) ||
      fallback.orderId ||
      "",
    uniqueId:
      deepGetFirst(body, ["UniqueID", "UniqueId"]) ||
      fallback.uniqueId ||
      "",
    terminalName:
      deepGetFirst(body, ["TerminalName", "terminalName", "Terminal"]) ||
      fallback.terminalName ||
      RECEIPT_TERMINAL_NAME,
    terminalNumber:
      deepGetFirst(body, ["TerminalNumber", "terminalNumber", "TerminalNo", "terminalNo"]) ||
      fallback.terminalNumber ||
      RECEIPT_TERMINAL_NUMBER,
    softwareVersion:
      deepGetFirst(body, ["SoftwareVersion", "softwareVersion", "Version", "version"]) ||
      fallback.softwareVersion ||
      RECEIPT_SOFTWARE_VERSION,
    merchantNumber:
      deepGetFirst(body, ["MerchantNumber", "merchantNumber", "MerchantId", "merchantId", "BusinessNumber"]) ||
      fallback.merchantNumber ||
      RECEIPT_MERCHANT_NUMBER,
    transactionDateTime: formatDateTimeValue(
      deepGetFirst(body, [
        "TransactionDateTime",
        "transactionDateTime",
        "TransactionTime",
        "transactionTime",
        "DealDateTime",
        "dealDateTime",
        "CreateDate",
        "createDate",
        "Date",
        "date",
      ]) || fallback.transactionDateTime
    ),
    cardName:
      deepGetFirst(body, ["CardName", "cardName", "CardBrand", "cardBrand", "CardTypeName", "cardTypeName"]) ||
      fallback.cardName ||
      "",
    cardNumberLast4:
      deepGetFirst(body, ["CardLast4Digits", "cardLast4Digits", "Last4", "last4", "CardNumber", "cardNumber", "Pan", "pan", "CardMask", "cardMask"]) ||
      fallback.cardNumberLast4 ||
      "",
    voucherNumber:
      deepGetFirst(body, ["VoucherNumber", "voucherNumber", "DocumentNumber", "documentNumber", "Shovar", "shovar", "ReceiptNumber", "receiptNumber"]) ||
      fallback.voucherNumber ||
      "",
    uid:
      deepGetFirst(body, ["UID", "uid", "TransactionUid", "transactionUid"]) ||
      fallback.uid ||
      "",
    rrn:
      deepGetFirst(body, ["RRN", "rrn", "RetrievalReferenceNumber", "retrievalReferenceNumber"]) ||
      fallback.rrn ||
      "",
    transactionType:
      deepGetFirst(body, ["TransactionType", "transactionType", "DealType", "dealType", "DebitCredit", "debitCredit"]) ||
      fallback.transactionType ||
      RECEIPT_DEFAULT_TRANSACTION_TYPE,
    issuerApprovalNumber:
      deepGetFirst(body, ["ApprovalNumber", "approvalNumber", "IssuerApprovalNumber", "issuerApprovalNumber", "ApprovalCode", "approvalCode"]) ||
      fallback.issuerApprovalNumber ||
      "",
    approver:
      deepGetFirst(body, ["Approver", "approver", "ApproverName", "approverName", "ApprovalEntity", "approvalEntity", "Authorizer", "authorizer"]) ||
      fallback.approver ||
      RECEIPT_DEFAULT_APPROVER,
    executionMethod:
      deepGetFirst(body, ["ExecutionMethod", "executionMethod", "EntryMode", "entryMode", "TransactionChannel", "transactionChannel"]) ||
      fallback.executionMethod ||
      RECEIPT_DEFAULT_EXECUTION_METHOD,
    creditType: formatCreditTypeValue(
      deepGetFirst(body, ["CreditType", "creditType", "PaymentType", "paymentType", "CreditTerms", "creditTerms"]) ||
      fallback.creditType
    ),
    amount: formatAmountValue(
      deepGetFirst(body, ["Amount", "amount", "Total", "total", "TransactionAmount", "transactionAmount"]) ||
      fallback.amount
    ),
    currency: formatCurrencyValue(
      deepGetFirst(body, ["Currency", "currency"]) || fallback.currency
    ),
    approvalStatus:
      deepGetFirst(body, ["Status", "status", "ResponseMessage", "responseMessage", "ReturnMessage", "returnMessage"]) ||
      fallback.approvalStatus ||
      "התשלום בוצע בהצלחה",
  };

  if (receipt.cardNumberLast4) {
    const digits = String(receipt.cardNumberLast4).replace(/[^\d]/g, "");
    if (digits.length >= 4) receipt.cardNumberLast4 = digits.slice(-4);
  }

  return receipt;
}

function isReceiptComplete(receipt) {
  if (!receipt) return false;
  return Boolean(
    String(receipt.transactionDateTime || "").trim() &&
    String(receipt.cardName || "").trim() &&
    String(receipt.voucherNumber || "").trim() &&
    String(receipt.issuerApprovalNumber || "").trim()
  );
}

async function requestOtp(phone, orderId, mode = "auto") {
  const response = await fetch(otpBaseUrl() + "/otp/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, orderId, mode }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text || "otp request failed" };
  }

  return { status: response.status, data };
}

async function verifyOtp(phone, orderId, code) {
  const response = await fetch(otpBaseUrl() + "/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, orderId, code }),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text || "otp verify failed" };
  }

  return { status: response.status, data };
}

async function createZCreditSession({ orderId, amount, name, phone972, phoneLocal }) {
  if (!BASE_URL || !ZC_KEY) {
    throw new Error("Missing BASE_URL or ZC_KEY in Railway.");
  }

  const cleanId = cleanOrderId(orderId);
  const total = toAmountNumber(amount);
  if (!cleanId || !Number.isFinite(total) || total <= 0) {
    throw new Error("Invalid form data");
  }

  const customerName = String(name || "").trim();
  if (!customerName) throw new Error("Missing name");

  if (!String(phone972 || "").startsWith("972")) {
    throw new Error("OTP phone invalid");
  }

  const uniqueId = "order-" + cleanId + "-" + Date.now();

  saveReceipt(uniqueId, cleanId, {
    customerName,
    phone: phoneLocal || normalizePhoneLocal(phone972),
    orderId: cleanId,
    uniqueId,
    amount: total.toFixed(2),
    currency: RECEIPT_DEFAULT_CURRENCY,
    approvalStatus: "ממתין לאישור סופי",
    terminalName: RECEIPT_TERMINAL_NAME,
    terminalNumber: RECEIPT_TERMINAL_NUMBER,
    softwareVersion: RECEIPT_SOFTWARE_VERSION,
    merchantNumber: RECEIPT_MERCHANT_NUMBER,
    executionMethod: RECEIPT_DEFAULT_EXECUTION_METHOD,
    approver: RECEIPT_DEFAULT_APPROVER,
    transactionType: RECEIPT_DEFAULT_TRANSACTION_TYPE,
    creditType: RECEIPT_DEFAULT_CREDIT_TYPE,
    createdAt: Date.now(),
  });

  const payload = {
    Key: String(ZC_KEY),

    ...(ZC_TERMINAL ? { TerminalNumber: String(ZC_TERMINAL) } : {}),
    ...(ZC_PASSWORD ? { Password: String(ZC_PASSWORD) } : {}),

    UniqueID: uniqueId,
    CallBackUrl: BASE_URL + "/zc-callback",
    SuccessUrl: BASE_URL + "/payment-success?orderId=" + encodeURIComponent(cleanId) + "&uniqueId=" + encodeURIComponent(uniqueId),
    CancelUrl: BASE_URL + "/payment-cancel?orderId=" + encodeURIComponent(cleanId) + "&uniqueId=" + encodeURIComponent(uniqueId),

    Currency: "ILS",
    Total: total,
    AdjustAmount: true,
    ShowCart: false,
    AdditionalText: cleanId,

    Customer: {
      Name: customerName,
      PhoneNumber: String(phone972),
    },

    CartItems: [
      {
        Description: "תשלום להזמנה " + cleanId,
        Quantity: 1,
        UnitPrice: total,
        Amount: total,
        Currency: "ILS",
      },
    ],
  };

  const response = await fetch(
    "https://pci.zcredit.co.il/webcheckout/api/WebCheckout/CreateSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (data?.Data?.SessionUrl) {
    return { sessionUrl: data.Data.SessionUrl, uniqueId };
  }

  throw new Error(JSON.stringify(data));
}

function renderPaymentPage({ orderId, amount, otpMissing = false }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>תשלום להזמנה ${htmlEscape(orderId)}</title>

<style>
  body{
    font-family:Arial,Helvetica,sans-serif;
    background:linear-gradient(180deg,#f5f5f5,#e9e9e9);
    margin:0;
    padding:20px;
  }
  .card{
    max-width:520px;
    margin:50px auto;
    background:#ffffff;
    border-radius:20px;
    padding:28px;
    box-shadow:0 15px 40px rgba(0,0,0,.12);
  }
  .logo{text-align:center;margin-bottom:18px;}
  .logo img{max-width:260px;height:auto;}
  h1{text-align:center;margin:0 0 20px;font-size:22px;color:#222;}
  label{display:block;margin:14px 0 6px;font-weight:700;color:#333;}
  input{
    width:100%;
    padding:13px;
    border:1px solid #ddd;
    border-radius:12px;
    font-size:16px;
    direction:rtl;
    text-align:right;
    box-sizing:border-box;
  }
  input:focus{
    border-color:#c40000;
    outline:none;
    box-shadow:0 0 0 2px rgba(196,0,0,0,0.15);
  }
  button{
    width:100%;
    margin-top:20px;
    padding:15px;
    border:0;
    border-radius:14px;
    font-size:18px;
    font-weight:800;
    cursor:pointer;
    background:#c40000;
    color:#fff;
    transition:0.2s;
  }
  button:hover{ background:#a00000; }
  button[disabled]{
    background:#999;
    cursor:not-allowed;
  }
  .warn{
    background:#fff3cd;
    border:1px solid #ffe69c;
    color:#664d03;
    padding:12px 14px;
    border-radius:12px;
    margin:10px 0 16px;
    font-weight:700;
  }
  .loadingBox{
    display:none;
    margin-top:16px;
    text-align:center;
  }
  .spinner{
    width:36px;
    height:36px;
    border:4px solid #eee;
    border-top:4px solid #c40000;
    border-radius:50%;
    animation:spin 0.9s linear infinite;
    margin:0 auto 10px;
  }
  .loadingText{
    font-size:14px;
    color:#555;
    font-weight:700;
  }
  @keyframes spin{
    0%{transform:rotate(0deg);}
    100%{transform:rotate(360deg);}
  }
</style>
</head>

<body>
  <div class="card">
    <div class="logo">
      <img src="/logo.jpeg" alt="הטאבון">
    </div>

    <h1>תשלום להזמנה #${htmlEscape(orderId)}</h1>

    ${otpMissing ? `<div class="warn">⚠️ חסר OTP_SERVER_URL או OTP_SIGNING_SECRET ב-Railway</div>` : ``}

    <form method="POST" action="/otp/start" id="startForm">
      <input type="hidden" name="orderId" value="${htmlEscape(orderId)}" />

      <label>סכום לתשלום (₪)</label>
      <input name="amount" value="${htmlEscape(amount)}" required />

      <label>שם מלא</label>
      <input name="name" required />

      <label>טלפון</label>
      <input name="phone" required />

      <button type="submit" id="sendBtn">שלח קוד אימות</button>
    </form>

    <div class="loadingBox" id="loadingBox">
      <div class="spinner"></div>
      <div class="loadingText">שולחים קוד, נא להמתין...</div>
    </div>
  </div>

<script>
(function(){
  const form = document.getElementById('startForm');
  const btn = document.getElementById('sendBtn');
  const loadingBox = document.getElementById('loadingBox');

  form.addEventListener('submit', function(){
    btn.disabled = true;
    loadingBox.style.display = 'block';
  });
})();
</script>
</body>
</html>
`;
}

function renderOtpPage({ flow, flowId, error = "" }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>אימות קוד</title>

<style>
  body{
    font-family:Arial,Helvetica,sans-serif;
    background:linear-gradient(180deg,#f5f5f5,#e9e9e9);
    margin:0;
    padding:20px;
  }
  .card{
    max-width:420px;
    margin:60px auto;
    background:#ffffff;
    border-radius:20px;
    padding:28px;
    box-shadow:0 15px 40px rgba(0,0,0,.12);
  }
  h1{
    text-align:center;
    margin:0 0 12px;
    font-size:22px;
    color:#222;
  }
  .sub{
    text-align:center;
    color:#666;
    font-size:14px;
    line-height:1.5;
    margin-bottom:18px;
  }
  label{
    display:block;
    margin:14px 0 6px;
    font-weight:700;
    color:#333;
  }
  input{
    width:100%;
    padding:14px;
    border:1px solid #ddd;
    border-radius:12px;
    font-size:22px;
    font-weight:800;
    direction:ltr;
    text-align:center;
    letter-spacing:8px;
    box-sizing:border-box;
  }
  input:focus{
    border-color:#c40000;
    outline:none;
    box-shadow:0 0 0 2px rgba(196,0,0,0,0.15);
  }
  button{
    width:100%;
    margin-top:16px;
    padding:15px;
    border:0;
    border-radius:14px;
    font-size:18px;
    font-weight:800;
    cursor:pointer;
    background:#c40000;
    color:#fff;
  }
  button:hover{ background:#a00000; }
  button[disabled]{
    background:#aaa;
    cursor:not-allowed;
  }
  .error{
    color:#b00020;
    font-weight:700;
    margin-top:12px;
    text-align:center;
    white-space:pre-line;
  }
  .timer{
    text-align:center;
    margin-top:14px;
    font-size:15px;
    font-weight:700;
    color:#444;
  }
  .loadingBox{
    display:none;
    margin-top:14px;
    text-align:center;
  }
  .spinner{
    width:32px;
    height:32px;
    border:4px solid #eee;
    border-top:4px solid #c40000;
    border-radius:50%;
    animation:spin 0.9s linear infinite;
    margin:0 auto 10px;
  }
  .loadingText{
    font-size:14px;
    color:#555;
    font-weight:700;
  }
  @keyframes spin{
    0%{transform:rotate(0deg);}
    100%{transform:rotate(360deg);}
  }
</style>
</head>

<body>
  <div class="card">
    <h1>אימות קוד</h1>

    <div class="sub">
      הזן כאן את הקוד כדי להמשיך לתשלום.
    </div>

    ${error ? `<div class="error">${htmlEscape(error)}</div>` : ``}

    <form method="POST" action="/otp/${htmlEscape(flowId)}/verify" id="verifyForm">
      <label>קוד אימות (4 ספרות)</label>
      <input name="code" inputmode="numeric" maxlength="4" placeholder="••••" required />
      <button type="submit" id="verifyBtn">אישור</button>
    </form>

    <div class="loadingBox" id="verifyLoadingBox">
      <div class="spinner"></div>
      <div class="loadingText">מאמתים קוד, נא להמתין...</div>
    </div>

    <div class="timer" id="timer"></div>
  </div>

<script>
(function(){
  const otpExpiresAt = ${Number(flow.otpExpiresAt || 0)};
  const timerEl = document.getElementById('timer');

  function tick(){
    const left = Math.max(0, otpExpiresAt - Date.now());
    const totalSec = Math.ceil(left / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2,'0');
    const ss = String(totalSec % 60).padStart(2,'0');
    timerEl.textContent = "תוקף הקוד: " + mm + ":" + ss;
    if(left <= 0){
      timerEl.textContent = "תוקף הקוד: 00:00";
    }
  }

  tick();
  setInterval(tick, 500);

  const verifyForm = document.getElementById('verifyForm');
  const verifyBtn = document.getElementById('verifyBtn');
  const verifyLoadingBox = document.getElementById('verifyLoadingBox');

  verifyForm.addEventListener('submit', function(){
    verifyBtn.disabled = true;
    verifyLoadingBox.style.display = 'block';
  });
})();
</script>
</body>
</html>
`;
}

function renderReceiptPendingPage({ orderId, uniqueId, refreshCount = 0 }) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>מעבד אישור תשלום</title>
<meta http-equiv="refresh" content="1.2;url=/payment-success?orderId=${encodeURIComponent(orderId || "")}&uniqueId=${encodeURIComponent(uniqueId || "")}&r=${Number(refreshCount || 0) + 1}">

<style>
  body{
    font-family:Arial,Helvetica,sans-serif;
    background:#efefef;
    margin:0;
    padding:18px;
    color:#222;
  }
  .card{
    max-width:520px;
    margin:60px auto;
    background:#fff;
    border-radius:18px;
    padding:28px;
    box-shadow:0 10px 30px rgba(0,0,0,.10);
    border:1px solid #e8e8e8;
    text-align:center;
  }
  .logo{
    text-align:center;
    margin-bottom:12px;
  }
  .logo img{
    max-width:210px;
    height:auto;
  }
  h1{
    font-size:28px;
    margin:8px 0 14px;
  }
  .spinner{
    width:44px;
    height:44px;
    border:4px solid #eee;
    border-top:4px solid #c40000;
    border-radius:50%;
    animation:spin 0.9s linear infinite;
    margin:0 auto 14px;
  }
  .text{
    font-size:18px;
    font-weight:800;
    color:#444;
    line-height:1.5;
  }
  .sub{
    margin-top:10px;
    font-size:14px;
    color:#777;
  }
  @keyframes spin{
    0%{transform:rotate(0deg);}
    100%{transform:rotate(360deg);}
  }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <img src="/logo.jpeg" alt="הטאבון">
    </div>
    <h1>מעבד אישור תשלום</h1>
    <div class="spinner"></div>
    <div class="text">מעבד את אישור התשלום, נא להמתין...</div>
    <div class="sub">מספר הזמנה: ${htmlEscape(orderId || "-")}</div>
  </div>
</body>
</html>
`;
}

function renderSuccessReceipt({ receipt, orderId }) {
  const r = receipt || {};

  function row(label, value) {
    const v = value && String(value).trim() !== "" ? String(value) : "-";
    return `
      <div class="row">
        <div class="label">${htmlEscape(label)}</div>
        <div class="value">${htmlEscape(v)}</div>
      </div>
    `;
  }

  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>אישור תשלום</title>

<style>
  body{
    font-family:Arial,Helvetica,sans-serif;
    background:#efefef;
    margin:0;
    padding:18px;
    color:#222;
  }
  .receipt{
    max-width:620px;
    margin:0 auto;
    background:#fff;
    border-radius:18px;
    padding:20px 20px 18px;
    box-shadow:0 10px 30px rgba(0,0,0,.10);
    border:1px solid #e8e8e8;
  }
  .logo{
    text-align:center;
    margin-bottom:8px;
  }
  .logo img{
    max-width:210px;
    height:auto;
  }
  .title{
    text-align:center;
    font-size:26px;
    font-weight:900;
    margin:8px 0 10px;
  }
  .ok{
    text-align:center;
    color:#0a7a2f;
    font-size:17px;
    font-weight:800;
    margin-bottom:14px;
  }
  .topBox{
    background:#fafafa;
    border:1px solid #ececec;
    border-radius:14px;
    padding:10px 12px;
    margin-bottom:14px;
  }
  .topLine{
    display:grid;
    grid-template-columns:140px 1fr;
    gap:8px;
    margin:4px 0;
    font-size:15px;
    align-items:center;
  }
  .topLine .k{
    font-weight:800;
    color:#444;
  }
  .rows{
    margin-top:6px;
    border-top:1px dashed #d8d8d8;
    padding-top:6px;
  }
  .row{
    display:grid;
    grid-template-columns:190px 1fr;
    gap:10px;
    padding:6px 0;
    border-bottom:1px solid #f2f2f2;
    align-items:center;
  }
  .label{
    font-weight:800;
    color:#444;
  }
  .value{
    color:#111;
    word-break:break-word;
  }
  .amountBox{
    margin-top:14px;
    background:#fff8f8;
    border:1px solid #ffd9d9;
    border-radius:14px;
    padding:12px;
    text-align:center;
  }
  .amountTitle{
    font-size:14px;
    color:#555;
    margin-bottom:4px;
    font-weight:700;
  }
  .amountValue{
    font-size:30px;
    font-weight:900;
    color:#b00020;
    line-height:1.1;
  }
  .foot{
    margin-top:14px;
    text-align:center;
    color:#666;
    font-size:12px;
    line-height:1.45;
  }
  @media (max-width: 640px){
    .receipt{ padding:16px 14px; }
    .row{
      grid-template-columns:155px 1fr;
      gap:8px;
      padding:5px 0;
    }
    .topLine{
      grid-template-columns:110px 1fr;
    }
    .title{ font-size:23px; }
    .amountValue{ font-size:26px; }
  }
</style>
</head>
<body>
  <div class="receipt">
    <div class="logo">
      <img src="/logo.jpeg" alt="הטאבון">
    </div>

    <div class="title">אישור תשלום</div>
    <div class="ok">התשלום בוצע בהצלחה ✅</div>

    <div class="topBox">
      <div class="topLine"><span class="k">שם:</span> <span>${htmlEscape(r.customerName || "-")}</span></div>
      <div class="topLine"><span class="k">טלפון:</span> <span>${htmlEscape(r.phone || "-")}</span></div>
      <div class="topLine"><span class="k">מספר הזמנה:</span> <span>${htmlEscape(orderId || r.orderId || "-")}</span></div>
      <div class="topLine"><span class="k">תאריך ושעת העסקה:</span> <span>${htmlEscape(r.transactionDateTime || "-")}</span></div>
    </div>

    <div class="rows">
      ${row("שם מסוף", r.terminalName)}
      ${row("מספר מסוף", r.terminalNumber)}
      ${row("מספר עסק בחברת האשראי", r.merchantNumber)}
      ${row("שם כרטיס", r.cardName)}
      ${row("מספר כרטיס", r.cardNumberLast4)}
      ${row("מספר שובר", r.voucherNumber)}
      ${row("סוג עסקה", r.transactionType)}
      ${row("מספר אישור מנפיק", r.issuerApprovalNumber)}
      ${row("אופן ביצוע העסקה", r.executionMethod)}
      ${row("סוג אשראי", r.creditType)}
      ${row("מטבע", r.currency)}
    </div>

    <div class="amountBox">
      <div class="amountTitle">סכום העסקה</div>
      <div class="amountValue">${htmlEscape(r.amount || "-")} ${htmlEscape(r.currency || "")}</div>
    </div>

    <div class="foot">
      מסמך זה מהווה אישור תשלום שהופק ממערכת הסליקה.<br/>
      תודה שבחרתם בהטאבון 🍕
    </div>
  </div>
</body>
</html>
`;
}

function renderReceiptNotReadyPage() {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>אישור תשלום</title>
<style>
  body{
    font-family:Arial,Helvetica,sans-serif;
    background:#efefef;
    margin:0;
    padding:18px;
  }
  .card{
    max-width:520px;
    margin:60px auto;
    background:#fff;
    border-radius:18px;
    padding:30px;
    box-shadow:0 10px 30px rgba(0,0,0,.10);
    text-align:center;
  }
  .logo img{max-width:220px;height:auto;}
  h1{margin:20px 0 10px;font-size:28px;}
  p{font-size:16px;color:#555;line-height:1.6;}
</style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="/logo.jpeg" alt="הטאבון"></div>
    <h1>אישור התשלום עדיין לא זמין</h1>
    <p>אנא רענן את הדף בעוד מספר שניות.</p>
  </div>
</body>
</html>
`;
}

function renderCancelPage(orderId) {
  return `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>התשלום בוטל</title>
<style>
  body{
    font-family:Arial,Helvetica,sans-serif;
    background:#f4f4f4;
    margin:0;
    padding:24px;
  }
  .card{
    max-width:520px;
    margin:60px auto;
    background:#fff;
    border-radius:18px;
    padding:30px;
    box-shadow:0 10px 30px rgba(0,0,0,.10);
    text-align:center;
  }
  .logo img{max-width:220px;height:auto;}
  h1{margin:20px 0 10px;font-size:28px;}
  p{font-size:16px;color:#555;}
</style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="/logo.jpeg" alt="הטאבון"></div>
    <h1>התשלום בוטל ❌</h1>
    <p>מספר הזמנה: ${htmlEscape(orderId || "-")}</p>
  </div>
</body>
</html>
`;
}

// ===== HOME =====
app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

// ===== PAYMENT PAGE =====
app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = toAmountNumber(req.params.amount);

  if (!orderId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).send("Invalid parameters");
  }

  const otpMissing = !otpConfigOk();
  return res.type("html").send(renderPaymentPage({ orderId, amount, otpMissing }));
});

// ===== OTP START =====
app.post("/otp/start", async (req, res) => {
  try {
    if (!otpConfigOk()) {
      return res.status(500).send("OTP config missing");
    }

    const orderId = cleanOrderId(req.body?.orderId);
    const amount = toAmountNumber(req.body?.amount);
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();

    if (!orderId) return res.status(400).send("חסר מספר הזמנה");
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).send("סכום לא תקין");
    if (!name) return res.status(400).send("חסר שם");
    if (!phone) return res.status(400).send("חסר טלפון");

    const existing = findActiveFlow(orderId, phone);
    if (existing) {
      return res.redirect("/otp/" + existing.flowId);
    }

    const otpResp = await requestOtp(phone, orderId, "auto");

    if (!otpResp.data || otpResp.data.ok !== true) {
      return res.status(400).send("שגיאה בשליחת קוד");
    }

    const flowId = randomId();
    const expSeconds = Number(otpResp.data.expSeconds || otpResp.data.expiresInSeconds || 300);

    setFlow(flowId, {
      createdAt: Date.now(),
      orderId,
      amount,
      name,
      phone,
      otpExpiresAt: Date.now() + expSeconds * 1000,
    });

    return res.redirect("/otp/" + flowId);
  } catch (err) {
    console.error("otp/start error:", err);
    return res.status(500).send("שגיאה בשליחת קוד");
  }
});

// ===== OTP PAGE =====
app.get("/otp/:flowId", (req, res) => {
  const flowId = String(req.params.flowId || "");
  const flow = getFlow(flowId);

  if (!flow) {
    return res.status(404).send("תוקף האימות פג. חזור להתחלה.");
  }

  return res.type("html").send(
    renderOtpPage({
      flow,
      flowId,
      error: String(req.query.error || ""),
    })
  );
});

// ===== OTP VERIFY =====
app.post("/otp/:flowId/verify", async (req, res) => {
  try {
    if (!otpConfigOk()) {
      return res.status(500).send("OTP config missing");
    }

    const flowId = String(req.params.flowId || "");
    const flow = getFlow(flowId);

    if (!flow) {
      return res.status(404).send("תוקף האימות פג. חזור להתחלה.");
    }

    const code = String(req.body?.code || "").replace(/\D/g, "").slice(0, 4);
    if (code.length !== 4) {
      return res.redirect("/otp/" + flowId + "?error=" + encodeURIComponent("נא להזין 4 ספרות"));
    }

    const verifyResp = await verifyOtp(flow.phone, flow.orderId, code);

    if (!verifyResp.data || verifyResp.data.ok !== true || verifyResp.data.verified !== true) {
      return res.redirect("/otp/" + flowId + "?error=" + encodeURIComponent("קוד לא תקין"));
    }

    const phone972 = String(verifyResp.data.phone972 || "");
    if (!phone972) {
      return res.redirect("/otp/" + flowId + "?error=" + encodeURIComponent("שגיאה באימות"));
    }

    const created = await createZCreditSession({
      orderId: flow.orderId,
      amount: flow.amount,
      name: flow.name,
      phone972,
      phoneLocal: normalizePhoneLocal(flow.phone),
    });

    otpFlows.delete(flowId);
    return res.redirect(created.sessionUrl);
  } catch (err) {
    console.error("otp verify/redirect error:", err);
    return res.redirect("/otp/" + req.params.flowId + "?error=" + encodeURIComponent("שגיאה במעבר לתשלום"));
  }
});

// ===== LEGACY ISSUE TOKEN ROUTE =====
app.post("/otp/issue-token", (req, res) => {
  try {
    if (!otpConfigOk()) {
      return res.status(500).json({ ok: false, error: "OTP config missing" });
    }

    const orderId = cleanOrderId(req.body?.orderId);
    const phone972 = String(req.body?.phone972 || "").replace(/[^\d]/g, "");

    if (!orderId) return res.status(400).json({ ok: false, error: "orderId invalid" });
    if (!phone972.startsWith("972") || phone972.length < 12) {
      return res.status(400).json({ ok: false, error: "phone972 invalid" });
    }

    const token = hmacSign({
      orderId,
      phone972,
      exp: Date.now() + 10 * 60 * 1000,
    });

    return res.json({ ok: true, token });
  } catch {
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

// ===== LEGACY CREATE SESSION ROUTE =====
app.post("/create-session", async (req, res) => {
  try {
    if (!BASE_URL || !ZC_KEY) {
      return res.status(500).send("Missing BASE_URL or ZC_KEY in Railway.");
    }

    if (!otpConfigOk()) {
      return res.status(500).send("Missing OTP_SERVER_URL or OTP_SIGNING_SECRET in Railway.");
    }

    const { orderId, amount, name, phone, otp_token } = req.body;

    const cleanId = cleanOrderId(orderId);
    const total = toAmountNumber(amount);
    const customerName = String(name || "").trim();

    if (!cleanId || !Number.isFinite(total) || total <= 0) {
      return res.status(400).send("Invalid form data");
    }
    if (!customerName) return res.status(400).send("Missing name");

    const verified = hmacVerify(String(otp_token || ""));
    if (!verified) {
      return res.status(400).send("OTP token invalid/expired");
    }
    if (verified.orderId !== cleanId) {
      return res.status(400).send("OTP token does not match order");
    }

    const phone972 = String(verified.phone972 || "");
    if (!phone972.startsWith("972")) {
      return res.status(400).send("OTP phone invalid");
    }

    const created = await createZCreditSession({
      orderId: cleanId,
      amount: total,
      name: customerName,
      phone972,
      phoneLocal: normalizePhoneLocal(phone || phone972),
    });

    return res.redirect(created.sessionUrl);
  } catch (err) {
    console.error("create-session error:", err);
    return res.status(500).send("Server error");
  }
});

// ===== ZC CALLBACK =====
app.all("/zc-callback", (req, res) => {
  try {
    const body = req.body || {};

    const uniqueId =
      deepGetFirst(body, ["UniqueID", "UniqueId"]) || "";

    const orderId =
      cleanOrderId(
        deepGetFirst(body, ["AdditionalText", "additionalText", "OrderId", "orderId"])
      ) || "";

    const existing = getReceipt(uniqueId, orderId) || {};

    const receipt = normalizeReceiptData(body, {
      customerName: existing.customerName || "",
      phone: existing.phone || "",
      orderId: orderId || existing.orderId || "",
      uniqueId: uniqueId || existing.uniqueId || "",
      amount: existing.amount || "",
      terminalName: existing.terminalName || RECEIPT_TERMINAL_NAME,
      terminalNumber: existing.terminalNumber || RECEIPT_TERMINAL_NUMBER,
      softwareVersion: existing.softwareVersion || RECEIPT_SOFTWARE_VERSION,
      merchantNumber: existing.merchantNumber || RECEIPT_MERCHANT_NUMBER,
      executionMethod: existing.executionMethod || RECEIPT_DEFAULT_EXECUTION_METHOD,
      approver: existing.approver || RECEIPT_DEFAULT_APPROVER,
      transactionType: existing.transactionType || RECEIPT_DEFAULT_TRANSACTION_TYPE,
      creditType: existing.creditType || RECEIPT_DEFAULT_CREDIT_TYPE,
      currency: existing.currency || RECEIPT_DEFAULT_CURRENCY,
    });

    saveReceipt(uniqueId || existing.uniqueId || "", orderId || existing.orderId || "", {
      ...existing,
      ...receipt,
      rawBody: body,
      createdAt: existing.createdAt || Date.now(),
    });

    console.log("========== ZC CALLBACK ==========");
    console.log("Time:", new Date().toISOString());
    console.log("Body:", body);
    console.log("================================");
  } catch (err) {
    console.error("zc-callback error:", err);
  }

  res.status(200).send("OK");
});

// ===== SUCCESS RECEIPT =====
app.get("/payment-success", (req, res) => {
  const orderId = cleanOrderId(req.query.orderId || "");
  const uniqueId = String(req.query.uniqueId || "").trim();
  const refreshCount = Math.max(0, Number(req.query.r || 0) || 0);

  const receipt = getReceipt(uniqueId, orderId);

  if (!receipt) {
    if (refreshCount < 8) {
      return res.type("html").send(
        renderReceiptPendingPage({
          orderId,
          uniqueId,
          refreshCount,
        })
      );
    }
    return res.type("html").send(renderReceiptNotReadyPage());
  }

  if (!isReceiptComplete(receipt)) {
    if (refreshCount < 8) {
      return res.type("html").send(
        renderReceiptPendingPage({
          orderId,
          uniqueId,
          refreshCount,
        })
      );
    }
    return res.type("html").send(renderReceiptNotReadyPage());
  }

  return res.type("html").send(
    renderSuccessReceipt({
      receipt,
      orderId,
    })
  );
});

// ===== CANCEL =====
app.get("/payment-cancel", (req, res) => {
  const orderId = cleanOrderId(req.query.orderId || "");
  return res.type("html").send(renderCancelPage(orderId));
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
