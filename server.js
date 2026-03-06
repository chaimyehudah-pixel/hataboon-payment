const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;

// כתובת שרת ה-OTP (ה-trycloudflare הפעיל שלך)
const OTP_SERVER_URL = (process.env.OTP_SERVER_URL || "").trim();

// סוד חתימה פנימי
const OTP_SIGNING_SECRET = process.env.OTP_SIGNING_SECRET || "";

// ===== Helpers =====
function cleanOrderId(v) {
  return String(v || "").replace(/\D/g, "");
}

function toAmountNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
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

  let obj;
  try {
    obj = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!obj || !obj.exp || Date.now() > obj.exp) return null;
  return obj;
}

function otpConfigOk() {
  return Boolean(OTP_SERVER_URL) && Boolean(OTP_SIGNING_SECRET);
}

function otpBaseUrl() {
  return OTP_SERVER_URL.replace(/\/+$/g, "");
}

// ====== HOME ======
app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

// ====== OTP PROXY דרך Railway ======
app.post("/otp/request", async (req, res) => {
  try {
    if (!OTP_SERVER_URL) {
      return res.status(500).json({ ok: false, error: "OTP_SERVER_URL missing" });
    }

    const response = await fetch(otpBaseUrl() + "/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });

    const text = await response.text();
    return res.status(response.status).type("application/json").send(text);
  } catch (err) {
    console.error("otp/request proxy error:", err);
    return res.status(500).json({ ok: false, error: "שגיאה בשליחת קוד" });
  }
});

app.post("/otp/verify", async (req, res) => {
  try {
    if (!OTP_SERVER_URL) {
      return res.status(500).json({ ok: false, error: "OTP_SERVER_URL missing" });
    }

    const response = await fetch(otpBaseUrl() + "/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });

    const text = await response.text();
    return res.status(response.status).type("application/json").send(text);
  } catch (err) {
    console.error("otp/verify proxy error:", err);
    return res.status(500).json({ ok: false, error: "שגיאה באימות" });
  }
});

// ====== PAYMENT PAGE (כולל OTP) ======
app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const amount = toAmountNumber(req.params.amount);

  if (!orderId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).send("Invalid parameters");
  }

  const otpMissing = !otpConfigOk();

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>תשלום להזמנה ${orderId}</title>

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
  h1{text-align:center;margin:0 0 14px;font-size:22px;color:#222;}
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
    margin-top:16px;
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
  button.secondary{
    background:#444;
  }
  button.secondary:hover{ background:#2d2d2d; }

  .note{
    text-align:center;
    margin-top:10px;
    font-size:13px;
    color:#777;
    line-height:1.4;
  }
  .warn{
    background:#fff3cd;
    border:1px solid #ffe69c;
    color:#664d03;
    padding:12px 14px;
    border-radius:12px;
    margin:10px 0 12px;
    font-weight:700;
  }
  .small{
    font-size:12px;
    color:#666;
    margin-top:6px;
    line-height:1.35;
  }
  .error{
    color:#b00020;
    font-weight:700;
    margin-top:10px;
    text-align:center;
    white-space:pre-line;
  }
  .success{
    color:#0a7a2f;
    font-weight:700;
    margin-top:10px;
    text-align:center;
    white-space:pre-line;
  }
  .hidden{ display:none; }

  .timer{
    text-align:center;
    font-weight:800;
    margin-top:8px;
  }

  .otpBox{
    margin-top:10px;
    padding-top:10px;
    border-top:1px solid #eee;
  }

  .otpInput{
    letter-spacing:8px;
    text-align:center;
    direction:ltr;
    font-size:22px;
    font-weight:800;
  }
</style>
</head>

<body>
  <div class="card">

    <div class="logo">
      <img src="/logo.jpeg" alt="הטאבון">
    </div>

    <h1>תשלום להזמנה #${orderId}</h1>

    ${otpMissing ? `<div class="warn">⚠️ חסר OTP_SERVER_URL או OTP_SIGNING_SECRET ב-Railway (לא ניתן לשלוח קוד אימות)</div>` : ``}

    <form id="detailsForm" ${otpMissing ? `class="hidden"` : ``}>
      <input type="hidden" id="orderId" value="${orderId}" />
      <label>סכום לתשלום (₪)</label>
      <input id="amount" value="${amount}" required />

      <label>שם מלא</label>
      <input id="name" required />

      <label>טלפון</label>
      <input id="phone" required />

      <label>אימייל (לצורך חשבונית בלבד)</label>
      <input id="email" type="email" placeholder="לא חובה" />

      <button type="submit" id="sendOtpBtn">שלח קוד אימות לוואטסאפ</button>

      <div class="note">
        לפני התשלום יישלח קוד אימות לוואטסאפ כדי לוודא שהטלפון נכון ✅
      </div>

      <div id="msg1" class="error hidden"></div>
      <div id="ok1" class="success hidden"></div>

      <div id="otpSection" class="otpBox hidden">
        <div class="small" style="text-align:center;">
          שלחנו קוד אימות לוואטסאפ. הזינו כאן את הקוד (4 ספרות).<br/>
          אם לא הגיע — בדקו שהמספר נכון ושיש לכם וואטסאפ על המספר הזה.
        </div>

        <div class="timer" id="timer"></div>

        <label>קוד אימות (4 ספרות)</label>
        <input id="otp" class="otpInput" inputmode="numeric" maxlength="4" placeholder="••••" />

        <button type="button" id="verifyBtn" class="secondary">אמת קוד והמשך</button>
        <button type="button" id="resendBtn" class="secondary">שלח שוב קוד</button>

        <div id="msg2" class="error hidden"></div>
        <div id="ok2" class="success hidden"></div>
      </div>
    </form>

    <form id="payForm" method="POST" action="/create-session" class="hidden">
      <input type="hidden" name="orderId" id="pay_orderId" />
      <input type="hidden" name="amount" id="pay_amount" />
      <input type="hidden" name="name" id="pay_name" />
      <input type="hidden" name="email" id="pay_email" />
      <input type="hidden" name="otp_token" id="pay_otp_token" />
      <button class="pay" type="submit">המשך לתשלום</button>

      <div class="note">
        התשלום מתבצע באמצעות מערכת מאובטחת של Z-Credit
      </div>
    </form>

  </div>

<script>
(function(){
  const OTP_URL = "";
  const orderIdEl = document.getElementById('orderId');
  const amountEl = document.getElementById('amount');
  const nameEl = document.getElementById('name');
  const phoneEl = document.getElementById('phone');
  const emailEl = document.getElementById('email');

  const detailsForm = document.getElementById('detailsForm');
  const otpSection = document.getElementById('otpSection');

  const msg1 = document.getElementById('msg1');
  const ok1 = document.getElementById('ok1');
  const msg2 = document.getElementById('msg2');
  const ok2 = document.getElementById('ok2');

  const sendOtpBtn = document.getElementById('sendOtpBtn');
  const verifyBtn = document.getElementById('verifyBtn');
  const resendBtn = document.getElementById('resendBtn');
  const otpEl = document.getElementById('otp');
  const timerEl = document.getElementById('timer');

  const payForm = document.getElementById('payForm');
  const pay_orderId = document.getElementById('pay_orderId');
  const pay_amount = document.getElementById('pay_amount');
  const pay_name = document.getElementById('pay_name');
  const pay_email = document.getElementById('pay_email');
  const pay_otp_token = document.getElementById('pay_otp_token');

  function show(el, txt){
    el.classList.remove('hidden');
    el.textContent = txt || '';
  }
  function hide(el){
    el.classList.add('hidden');
    el.textContent = '';
  }

  function keyForState(orderId){
    return "hataboon_otp_state_" + orderId;
  }

  function saveState(orderId, state){
    try{ sessionStorage.setItem(keyForState(orderId), JSON.stringify(state)); }catch(e){}
  }
  function loadState(orderId){
    try{
      const s = sessionStorage.getItem(keyForState(orderId));
      return s ? JSON.parse(s) : null;
    }catch(e){ return null; }
  }
  function clearState(orderId){
    try{ sessionStorage.removeItem(keyForState(orderId)); }catch(e){}
  }

  let timerInt = null;
  function startTimer(expAtMs){
    if(timerInt) clearInterval(timerInt);
    function tick(){
      const left = Math.max(0, expAtMs - Date.now());
      const sec = Math.floor(left/1000);
      const m = String(Math.floor(sec/60)).padStart(2,'0');
      const s = String(sec%60).padStart(2,'0');
      timerEl.textContent = left>0 ? ("תוקף הקוד: " + m + ":" + s) : "פג תוקף הקוד. לחץ 'שלח שוב קוד'";
      if(left<=0){
        clearInterval(timerInt);
        timerInt = null;
      }
    }
    tick();
    timerInt = setInterval(tick, 500);
  }

  function setButtonsLocked(isLocked){
    sendOtpBtn.disabled = isLocked;
    resendBtn.disabled = isLocked;
    verifyBtn.disabled = isLocked;
  }

  async function postJson(url, bodyObj){
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(bodyObj)
    });
    const txt = await res.text();
    let obj = null;
    try{ obj = JSON.parse(txt); }catch(e){ obj = { ok:false, error: txt || ('HTTP '+res.status) }; }
    if(!res.ok && obj && obj.ok !== true){
      return obj;
    }
    return obj;
  }

  function readForm(){
    return {
      orderId: String(orderIdEl.value||'').trim(),
      amount: String(amountEl.value||'').trim(),
      name: String(nameEl.value||'').trim(),
      phone: String(phoneEl.value||'').trim(),
      email: String(emailEl.value||'').trim(),
    };
  }

  (function restore(){
    const orderId = String(orderIdEl.value||'').trim();
    const st = loadState(orderId);
    if(st && st.step === 'otp_sent' && st.expAt && Date.now() < st.expAt){
      otpSection.classList.remove('hidden');
      startTimer(st.expAt);
      show(ok1, "כבר שלחנו קוד לוואטסאפ. הזן את הקוד כדי להמשיך.");
      hide(msg1);
    }
  })();

  detailsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hide(msg1); hide(ok1); hide(msg2); hide(ok2);

    const f = readForm();
    if(!f.orderId){ show(msg1,'חסר מספר הזמנה'); return; }
    if(!f.amount){ show(msg1,'חסר סכום'); return; }
    if(!f.name){ show(msg1,'חסר שם'); return; }
    if(!f.phone){ show(msg1,'חסר טלפון'); return; }

    const st = loadState(f.orderId);
    if(st && st.step === 'otp_sent' && st.expAt && Date.now() < st.expAt){
      otpSection.classList.remove('hidden');
      startTimer(st.expAt);
      show(ok1, "כבר שלחנו קוד לוואטסאפ. הזן את הקוד כדי להמשיך.");
      return;
    }

    try{
      setButtonsLocked(true);

      const resp = await postJson("/otp/request", { phone: f.phone, orderId: f.orderId });

      if(!resp || resp.ok !== true){
        show(msg1, (resp && resp.error) ? resp.error : 'שגיאה בשליחת קוד');
        return;
      }

      const expAt = Date.now() + ((resp.expSeconds ? Number(resp.expSeconds) : 300) * 1000);

      saveState(f.orderId, { step:'otp_sent', expAt });

      otpSection.classList.remove('hidden');
      startTimer(expAt);
      show(ok1, "קוד נשלח לוואטסאפ ✅");
      hide(msg1);

    } catch(err){
      show(msg1, 'שגיאה בשליחת קוד');
    } finally {
      setButtonsLocked(false);
    }
  });

  resendBtn.addEventListener('click', async () => {
    hide(msg1); hide(ok1); hide(msg2); hide(ok2);

    const f = readForm();
    if(!f.phone){ show(msg2,'חסר טלפון'); return; }

    try{
      setButtonsLocked(true);

      const resp = await postJson("/otp/request", { phone: f.phone, orderId: f.orderId });

      if(!resp || resp.ok !== true){
        show(msg2, (resp && resp.error) ? resp.error : 'שגיאה בשליחת קוד');
        return;
      }

      const expAt = Date.now() + ((resp.expSeconds ? Number(resp.expSeconds) : 300) * 1000);
      saveState(f.orderId, { step:'otp_sent', expAt });

      startTimer(expAt);
      show(ok2, "קוד חדש נשלח ✅");
      hide(msg2);

    } catch(err){
      show(msg2, 'שגיאה בשליחת קוד');
    } finally {
      setButtonsLocked(false);
    }
  });

  verifyBtn.addEventListener('click', async () => {
    hide(msg2); hide(ok2);

    const f = readForm();
    const otp = String(otpEl.value||'').replace(/\\D/g,'').slice(0,4);
    if(otp.length !== 4){
      show(msg2, 'נא להזין 4 ספרות');
      return;
    }

    try{
      setButtonsLocked(true);

      const resp = await postJson("/otp/verify", { phone: f.phone, orderId: f.orderId, code: otp });

      if(!resp || resp.ok !== true){
        show(msg2, (resp && resp.error) ? resp.error : 'קוד לא תקין');
        return;
      }

      const phone972 = resp.phone972 || '';
      if(!phone972){
        show(msg2, 'שגיאה באימות');
        return;
      }

      const tokenResp = await postJson("/otp/issue-token", {
        orderId: f.orderId,
        phone972: phone972
      });

      if(!tokenResp || tokenResp.ok !== true || !tokenResp.token){
        show(msg2, 'שגיאה פנימית: לא הצלחתי להפיק טוקן');
        return;
      }

      pay_orderId.value = f.orderId;
      pay_amount.value = f.amount;
      pay_name.value = f.name;
      pay_email.value = f.email;
      pay_otp_token.value = tokenResp.token;

      clearState(f.orderId);

      detailsForm.classList.add('hidden');
      payForm.classList.remove('hidden');

      show(ok2, "אימות הצליח ✅ אפשר להמשיך לתשלום");

    } catch(err){
      show(msg2, 'שגיאה באימות');
    } finally {
      setButtonsLocked(false);
    }
  });

})();
</script>

</body>
</html>
`;

  res.type("html").send(html);
});

// ====== Issue signed token after OTP verified ======
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
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

// ====== CREATE SESSION ======
app.post("/create-session", async (req, res) => {
  try {
    if (!BASE_URL || !ZC_KEY) {
      return res.status(500).send("Missing BASE_URL or ZC_KEY in Railway.");
    }

    if (!otpConfigOk()) {
      return res.status(500).send("Missing OTP_SERVER_URL or OTP_SIGNING_SECRET in Railway.");
    }

    const { orderId, amount, name, email, otp_token } = req.body;

    const cleanId = cleanOrderId(orderId);
    const total = toAmountNumber(amount);

    if (!cleanId || !Number.isFinite(total) || total <= 0) {
      return res.status(400).send("Invalid form data");
    }

    const customerName = String(name || "").trim();
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

    const uniqueId = "order-" + cleanId + "-" + Date.now();

    const cleanEmail = String(email || "").trim();

    const customer = {
      Name: customerName,
      PhoneNumber: phone972,
      ...(cleanEmail ? { Email: cleanEmail } : {}),
    };

    const payload = {
      Key: String(ZC_KEY),

      ...(ZC_TERMINAL ? { TerminalNumber: String(ZC_TERMINAL) } : {}),
      ...(ZC_PASSWORD ? { Password: String(ZC_PASSWORD) } : {}),

      UniqueID: uniqueId,
      CallBackUrl: BASE_URL + "/zc-callback",
      SuccessUrl: BASE_URL + "/payment-success?orderId=" + cleanId,
      CancelUrl: BASE_URL + "/payment-cancel?orderId=" + cleanId,

      Currency: "ILS",
      Total: total,
      AdjustAmount: true,
      ShowCart: false,
      AdditionalText: cleanId,

      Customer: customer,

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
      return res.redirect(data.Data.SessionUrl);
    }

    return res.status(400).json(data);
  } catch (err) {
    console.error("create-session error:", err);
    return res.status(500).send("Server error");
  }
});

// ====== CALLBACK ======
app.all("/zc-callback", (req, res) => {
  console.log("========== ZC CALLBACK ==========");
  console.log("Time:", new Date().toISOString());
  console.log("Body:", req.body);
  console.log("================================");
  res.status(200).send("OK");
});

// ====== SUCCESS ======
app.get("/payment-success", (req, res) => {
  res.send("התשלום בוצע בהצלחה ✅ הזמנה: " + (req.query.orderId || ""));
});

// ====== CANCEL ======
app.get("/payment-cancel", (req, res) => {
  res.send("התשלום בוטל ❌");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
