const express = require("express");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL;
const ZC_KEY = process.env.ZC_KEY;
const ZC_TERMINAL = process.env.ZC_TERMINAL;
const ZC_PASSWORD = process.env.ZC_PASSWORD;

// ✅ חדש: כתובת ה-OTP Server שלך (דרך Cloudflare)
// דוגמה: https://untitled-him-quality-charm.trycloudflare.com
const OTP_SERVER_URL = (process.env.OTP_SERVER_URL || "").replace(/\/+$/g, "");

// ========= helpers =========

function normalizePhoneForOtp(phoneRaw) {
  // מחזיר 972XXXXXXXXX או null
  let d = String(phoneRaw || "").replace(/[^\d]/g, "");
  if (!d) return null;

  // 00972XXXXXXXXX -> 972XXXXXXXXX
  if (d.startsWith("00972")) d = d.slice(2);

  // 05XXXXXXXX -> 9725XXXXXXXX
  if (d.startsWith("0") && d.length === 10) d = "972" + d.slice(1);

  // 972XXXXXXXXX (בישראל זה לרוב 12 ספרות כולל 972)
  if (d.startsWith("972") && d.length >= 12) return d;

  return null;
}

function safeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// שמירה זמנית בזיכרון (לא DB) של "טופס שממתין לאימות"
// הערה: זה מתאפס אם Railway עושה Restart. זה בסדר להתחלה.
const pendingByKey = new Map();
// key = orderId|phone972
function pendingKey(orderId, phone972) {
  return `${orderId}|${phone972}`;
}

// ========= HOME =========
app.get("/", (req, res) => {
  res.send("Hataboon Payment Server Running 🍕");
});

// ========= PAYMENT PAGE =========
app.get("/pay/:orderId/:amount", (req, res) => {
  const orderId = String(req.params.orderId || "").replace(/\D/g, "");
  const amount = Number(req.params.amount);

  if (!orderId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).send("Invalid parameters");
  }

  const otpNotice = OTP_SERVER_URL
    ? ""
    : `<div style="background:#fff3cd;border:1px solid #ffeeba;padding:10px;border-radius:12px;margin-bottom:14px;color:#856404;font-weight:700;">
        ⚠️ חסר OTP_SERVER_URL ב-Railway (האתר לא יוכל לשלוח קוד אימות)
      </div>`;

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>תשלום להזמנה ${safeHtml(orderId)}</title>

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
  .logo{ text-align:center; margin-bottom:18px; }
  .logo img{ max-width:260px; height:auto; }
  h1{ text-align:center; margin:0 0 20px; font-size:22px; color:#222; }
  label{ display:block; margin:14px 0 6px; font-weight:700; color:#333; }
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
  button.pay{
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
  button.pay:hover{ background:#a00000; }
  .footer-note{ text-align:center; margin-top:12px; font-size:13px; color:#777; }
</style>
</head>

<body>
  <div class="card">
    <div class="logo">
      <img src="/logo.jpeg" alt="הטאבון">
    </div>

    <h1>תשלום להזמנה #${safeHtml(orderId)}</h1>

    ${otpNotice}

    <form method="POST" action="/create-session">
      <input type="hidden" name="orderId" value="${safeHtml(orderId)}" />

      <label>סכום לתשלום (₪)</label>
      <input name="amount" value="${safeHtml(amount)}" required />

      <label>שם מלא</label>
      <input name="name" required />

      <label>טלפון</label>
      <input name="phone" required />

      <label>אימייל (לצורך חשבונית בלבד)</label>
      <input type="email" name="email" placeholder="לא חובה" />

      <button class="pay" type="submit">המשך לתשלום</button>
    </form>

    <div class="footer-note">
      לפני התשלום יישלח קוד אימות לוואטסאפ כדי לוודא שהטלפון נכון ✅
    </div>
  </div>
</body>
</html>
`;

  res.type("html").send(html);
});

// ========= OTP PAGE =========
app.get("/otp", (req, res) => {
  const orderId = String(req.query.orderId || "").replace(/\D/g, "");
  const phone = String(req.query.phone || "");
  const phone972 = normalizePhoneForOtp(phone);

  if (!orderId || !phone972) return res.status(400).send("Invalid parameters");

  const key = pendingKey(orderId, phone972);
  const pending = pendingByKey.get(key);

  if (!pending) {
    return res
      .status(400)
      .send("לא נמצאה בקשה פעילה לקוד. נסה שוב דרך דף התשלום.");
  }

  const html = `
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>אימות טלפון</title>
<style>
  body{ font-family:Arial,Helvetica,sans-serif; background:#f4f4f4; margin:0; padding:20px; }
  .card{ max-width:520px; margin:50px auto; background:#fff; border-radius:20px; padding:28px; box-shadow:0 15px 40px rgba(0,0,0,.12); }
  h1{ margin:0 0 10px; font-size:22px; text-align:center; }
  p{ margin:6px 0; color:#333; text-align:center; }
  input{
    width:100%;
    padding:13px;
    border:1px solid #ddd;
    border-radius:12px;
    font-size:18px;
    text-align:center;
    box-sizing:border-box;
    letter-spacing:2px;
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
  .muted{ color:#777; font-size:13px; margin-top:10px; }
</style>
</head>
<body>
  <div class="card">
    <h1>אימות טלפון</h1>
    <p>שלחנו קוד אימות לוואטסאפ</p>
    <p><b>${safeHtml(phone)}</b></p>

    <form method="POST" action="/otp/verify">
      <input type="hidden" name="orderId" value="${safeHtml(orderId)}" />
      <input type="hidden" name="phone" value="${safeHtml(phone)}" />

      <p style="margin-top:16px;font-weight:700;">הכנס קוד (6 ספרות)</p>
      <input name="code" inputmode="numeric" maxlength="6" placeholder="______" required />

      <button type="submit">אמת והמשך לתשלום</button>
    </form>

    <p class="muted">הקוד בתוקף ל-5 דקות</p>
  </div>
</body>
</html>
`;
  res.type("html").send(html);
});

// ========= CREATE SESSION (אבל קודם OTP) =========
app.post("/create-session", async (req, res) => {
  try {
    const { orderId, amount, name, phone, email } = req.body;

    if (!BASE_URL || !ZC_KEY) {
      return res.status(500).send("Missing BASE_URL or ZC_KEY in Railway.");
    }
    if (!OTP_SERVER_URL) {
      return res.status(500).send("Missing OTP_SERVER_URL in Railway.");
    }

    const cleanOrderId = String(orderId || "").replace(/\D/g, "");
    const total = Number(amount);
    const phone972 = normalizePhoneForOtp(phone);

    if (!cleanOrderId || !Number.isFinite(total) || total <= 0) {
      return res.status(400).send("Invalid form data");
    }
    if (!phone972) {
      return res.status(400).send("טלפון לא תקין. נא להזין מספר ישראלי תקין.");
    }

    // שומרים את פרטי הטופס "בהמתנה לאימות"
    const key = pendingKey(cleanOrderId, phone972);
    pendingByKey.set(key, {
      createdAt: Date.now(),
      orderId: cleanOrderId,
      amount: total,
      name: String(name || ""),
      phone: String(phone || ""),
      phone972,
      email: String(email || "").trim(),
    });

    // קוראים ל-OTP server: /otp/request
    const otpResp = await fetch(OTP_SERVER_URL + "/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: String(phone || ""), orderId: cleanOrderId }),
    });

    // אם נכשל - מחזירים הודעה ברורה
    if (!otpResp.ok) {
      const txt = await otpResp.text().catch(() => "");
      console.error("OTP request failed:", otpResp.status, txt);
      return res
        .status(500)
        .send("שגיאה בשליחת קוד אימות. נסה שוב בעוד רגע.");
    }

    // מעבירים את הלקוח למסך הזנת קוד
    return res.redirect(
      "/otp?orderId=" +
        encodeURIComponent(cleanOrderId) +
        "&phone=" +
        encodeURIComponent(String(phone || ""))
    );
  } catch (err) {
    console.error("create-session error:", err);
    return res.status(500).send("Server error");
  }
});

// ========= OTP VERIFY -> ורק אז Z-Credit =========
app.post("/otp/verify", async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").replace(/\D/g, "");
    const phone = String(req.body?.phone || "");
    const code = String(req.body?.code || "").replace(/[^\d]/g, "");

    if (!orderId) return res.status(400).send("orderId missing");
    if (!code || code.length < 4) return res.status(400).send("code invalid");
    if (!OTP_SERVER_URL) return res.status(500).send("Missing OTP_SERVER_URL");

    const phone972 = normalizePhoneForOtp(phone);
    if (!phone972) return res.status(400).send("phone invalid");

    const key = pendingKey(orderId, phone972);
    const pending = pendingByKey.get(key);
    if (!pending) {
      return res
        .status(400)
        .send("לא נמצאה בקשה פעילה. חזור לדף התשלום ונסה שוב.");
    }

    // אימות מול ה-OTP server: /otp/verify
    const verifyResp = await fetch(OTP_SERVER_URL + "/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: String(phone || ""),
        orderId: orderId,
        code: code,
      }),
    });

    const verifyJson = await verifyResp.json().catch(() => null);
    if (!verifyResp.ok || !verifyJson || verifyJson.ok !== true) {
      return res
        .status(400)
        .send("קוד שגוי או פג תוקף. חזור אחורה ונסה שוב.");
    }

    // ✅ קוד נכון -> ממשיכים ל-Z-Credit
    const uniqueId = "order-" + orderId + "-" + Date.now();

    const cleanEmail = String(pending.email || "").trim();

    const customer = {
      Name: String(pending.name || ""),
      PhoneNumber: String(pending.phone || ""),
      ...(cleanEmail ? { Email: cleanEmail } : {}),
    };

    const payload = {
      Key: String(ZC_KEY),

      ...(ZC_TERMINAL ? { TerminalNumber: String(ZC_TERMINAL) } : {}),
      ...(ZC_PASSWORD ? { Password: String(ZC_PASSWORD) } : {}),

      UniqueID: uniqueId,
      CallBackUrl: BASE_URL + "/zc-callback",
      SuccessUrl: BASE_URL + "/payment-success?orderId=" + orderId,
      CancelUrl: BASE_URL + "/payment-cancel?orderId=" + orderId,

      Currency: "ILS",
      Total: Number(pending.amount),
      AdjustAmount: true,
      ShowCart: false,
      AdditionalText: orderId,

      Customer: customer,

      CartItems: [
        {
          Description: "תשלום להזמנה " + orderId,
          Quantity: 1,
          UnitPrice: Number(pending.amount),
          Amount: Number(pending.amount),
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
      // מנקים מהזיכרון שלא יישאר "pending"
      pendingByKey.delete(key);
      return res.redirect(data.Data.SessionUrl);
    }

    return res.status(400).json(data);
  } catch (err) {
    console.error("otp-verify error:", err);
    return res.status(500).send("Server error");
  }
});

// ========= CALLBACK =========
app.all("/zc-callback", (req, res) => {
  console.log("========== ZC CALLBACK ==========");
  console.log("Time:", new Date().toISOString());
  console.log("Body:", req.body);
  console.log("================================");
  res.status(200).send("OK");
});

// ========= SUCCESS =========
app.get("/payment-success", (req, res) => {
  res.send("התשלום בוצע בהצלחה ✅ הזמנה: " + (req.query.orderId || ""));
});

// ========= CANCEL =========
app.get("/payment-cancel", (req, res) => {
  res.send("התשלום בוטל ❌");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
