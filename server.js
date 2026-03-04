console.log('✅ הבוט התחיל...');

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PS = 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
const ACCESS_PS = 'C:\\Users\\USER\\Desktop\\WhatsAppAccessBot\\access.ps1';

const DB_PATH = '\\\\NEW-KITCHEN\\PizzaManager\\hair.mdb';
const DB_PWD  = 'gkgkgkgk';

const POLL_MS = 3000;

// ====== OTP CONFIG ======
const OTP_FILE = path.join(__dirname, 'otp_store.json');
const OTP_EXPIRE_MINUTES = 5;          // קוד בתוקף ל-5 דקות
const OTP_CODE_LENGTH = 6;             // 6 ספרות
const OTP_SMS_TYPE = 1;                // אם אצלך smsType אחר, תגיד לי ונעדכן
const OTP_DELAY_MINUTES = 0;           // לשלוח מיד
const OTP_SERVER_PORT = 3030;          // השרת המקומי ירוץ על 3030
// =======================

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function decodePsOutput(buf){
  if(!buf || !buf.length) return '';
  let zeros = 0;
  for (let i=0;i<buf.length;i++) if(buf[i]===0) zeros++;
  const looksUtf16 = zeros > buf.length*0.2 || (buf[0]===0xFF && buf[1]===0xFE);
  return buf.toString(looksUtf16 ? 'utf16le' : 'utf8');
}

function runAccess(action, extraArgs = {}){
  const args = [
    '-NoProfile','-ExecutionPolicy','Bypass',
    '-File', ACCESS_PS,
    '-Action', action,
    '-DbPath', DB_PATH,
    '-DbPwd', DB_PWD
  ];

  for(const [k,v] of Object.entries(extraArgs)){
    if(v === undefined || v === null || v === '') continue;
    args.push(`-${k}`, String(v));
  }

  const r = spawnSync(PS, args, { encoding:'buffer', windowsHide:true });
  const out = decodePsOutput(r.stdout).trim();
  const err = decodePsOutput(r.stderr).trim();

  if(r.status !== 0) throw new Error(err || out || `PowerShell failed (code ${r.status})`);
  if(!out) return { ok:true };

  let obj;
  try { obj = JSON.parse(out); }
  catch { throw new Error('פלט לא JSON מה-access.ps1: ' + out); }

  if(obj && obj.ok === false) throw new Error(obj.error || 'access.ps1 error');
  return obj;
}

function normalizeToWhatsAppId(phoneRaw){
  let d = String(phoneRaw || '').replace(/[^\d]/g,'');
  if(!d) return null;
  if(d.startsWith('00972')) d = d.slice(2);
  if(d.startsWith('0') && d.length === 10) d = '972' + d.slice(1);
  if(d.startsWith('972') && d.length >= 12) return `${d}@c.us`;
  return null;
}

function normalizePhoneDigits(phoneRaw){
  // מחזיר רק ספרות בפורמט ישראלי 972xxxxxxxxx
  let d = String(phoneRaw || '').replace(/[^\d]/g,'');
  if(!d) return null;
  if(d.startsWith('00972')) d = d.slice(2);
  if(d.startsWith('0') && d.length === 10) d = '972' + d.slice(1);
  if(d.startsWith('972') && d.length >= 12) return d;
  return null;
}

function makeDtDateNow(){
  const now = new Date();
  const yyyy = String(now.getFullYear()).padStart(4,'0');
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const hh = String(now.getHours()).padStart(2,'0');
  const mi = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`; // yyyymmddhhmmss
}

/* ===========================
   ✨ שינוי טקסטים אוטומטי
   =========================== */

function extractOrderNumber(text){
  const t = String(text || '');
  const m = t.match(/הזמנה\s+מס(?:׳|:)\s*\*?(\d{1,10})\*?/);
  return m ? m[1] : null;
}

function extractAmount(text){
  const t = String(text || '');
  const m = t.match(/על\s+סך:\s*₪?\s*([\d.,]+)/);
  if(!m) return null;

  let raw = m[1].trim();
  raw = raw.replace(/,/g, '');

  if(!/^\d+(\.\d+)?$/.test(raw)) return null;

  if(raw.includes('.')){
    const num = Number(raw);
    if(Number.isFinite(num) && Math.abs(num - Math.round(num)) < 1e-9) return String(Math.round(num));
    return raw;
  }

  return raw;
}

function addPaymentLinkIfUnpaid(msg){
  const t = String(msg || '');

  const marker = '*אי־תשלום ההזמנה, אינו מעכב את המשך ביצוע ההזמנה*';
  if(!t.includes(marker)) return t;

  const order = extractOrderNumber(t);
  const amount = extractAmount(t);

  let out = t.replace(new RegExp(`\\s*\\*אי־תשלום\\s+ההזמנה,\\s+אינו\\s+מעכב\\s+את\\s+המשך\\s+ביצוע\\s+ההזמנה\\*\\s*`, 'g'), '\n');
  out = out.replace(/\n{3,}/g, '\n\n');

  if(!order || !amount){
    console.log(`⚠️ לא הצלחתי לחלץ מספר הזמנה/סכום לקישור תשלום | order=${order} | amount=${amount}`);
    return out;
  }

  const url = `https://hataboon-payment-production.up.railway.app/pay/${order}/${amount}`;

  const sigRe = /(🍕\s*הטאבון[\s\S]*?$)/m;
  if(sigRe.test(out)){
    out = out.replace(sigRe, `${url}\n\n$1`);
  } else {
    out = out.trimEnd() + `\n\n${url}\n`;
  }

  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function transformMessage(text){
  let msg = String(text || '');
  msg = msg.replace(/^\s*"+|"+\s*$/g, '');

  const isLinkMessage =
    msg.includes('www.hataboon.co.il') &&
    (msg.includes('תפריט | אתר | אפליקציה') || msg.includes('קישור ל'));

  if(isLinkMessage){
    return `היי 😉
ראינו שהתקשרתם אלינו

רק רצינו לעדכן שיש לנו גם:
אתר ואפליקציה להזמנות אונליין

🌐 www.hataboon.co.il

הטאבון – קריית ארבע חברון 🍕`;
  }

  msg = addPaymentLinkIfUnpaid(msg);

  let out = msg
    .replace(/הזמנה מס:\s*([0-9]+)/g, 'הזמנה מס׳ $1\n')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n');

  out = out.replace(/\n?✅?\s*התשלום בוצע בהצלחה/g, '\n\n✅ התשלום בוצע בהצלחה');

  out = out.split('\n').map(l => l.replace(/[ \t]+$/g,'')).join('\n');

  return out.trim();
}

/* ===========================
   ➕ יצירת הודעת המשך "עוד כ-X דקות"
   =========================== */

function extractMinutesFromPreparationMessage(text){
  const t = String(text || '');
  const m = t.match(/בעוד\s*כ[- ]?\s*(\d+)\s*דקות/);
  if(!m) return null;
  const n = parseInt(m[1], 10);
  if(!Number.isFinite(n) || n <= 0 || n > 180) return null;
  return n;
}

const createdFollowups = new Set();
function followupKey(job){ return `${job.SMSPhone}__${job.dtDate}`; }

/* ===========================
   ✅ OTP STORE (otp_store.json)
   =========================== */

function ensureOtpFile(){
  try {
    if(!fs.existsSync(OTP_FILE)){
      fs.writeFileSync(OTP_FILE, '{}', 'utf8');
    }
  } catch(e){
    console.error('❌ לא הצלחתי ליצור otp_store.json:', e.message);
  }
}

function loadOtpStore(){
  ensureOtpFile();
  try{
    const raw = fs.readFileSync(OTP_FILE, 'utf8');
    const obj = JSON.parse(raw || '{}');
    if(obj && typeof obj === 'object') return obj;
    return {};
  } catch(e){
    console.error('❌ שגיאה בקריאת otp_store.json:', e.message);
    return {};
  }
}

function saveOtpStore(store){
  try{
    fs.writeFileSync(OTP_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch(e){
    console.error('❌ שגיאה בשמירת otp_store.json:', e.message);
  }
}

function otpKey(phone972, orderId){
  const p = String(phone972 || '').trim();
  const o = String(orderId || '').trim();
  return `${p}__${o}`;
}

function randomOtpCode(){
  // 6 ספרות, לא מתחיל ב-0
  const min = Math.pow(10, OTP_CODE_LENGTH-1);
  const max = Math.pow(10, OTP_CODE_LENGTH) - 1;
  return String(Math.floor(Math.random()*(max-min+1)) + min);
}

function cleanupExpiredOtps(store){
  const now = Date.now();
  let changed = false;
  for(const k of Object.keys(store)){
    const rec = store[k];
    if(!rec || !rec.expiresAt){
      delete store[k];
      changed = true;
      continue;
    }
    if(now > rec.expiresAt){
      delete store[k];
      changed = true;
    }
  }
  if(changed) saveOtpStore(store);
}

/* ===========================
   🌐 OTP SERVER (Express)
   =========================== */

function startOtpServer(){
  const app = express();
  app.use(express.json());

  // בדיקת חיים
  app.get('/health', (req,res) => {
    res.json({ ok:true, name:'WhatsAppAccessBot OTP', port: OTP_SERVER_PORT });
  });

  // בקשת קוד OTP
  // body: { phone: "05...", orderId: "12345" }
  app.post('/otp/request', (req,res) => {
    try{
      const phone972 = normalizePhoneDigits(req.body?.phone);
      const orderId = String(req.body?.orderId || '').trim();

      if(!phone972) return res.status(400).json({ ok:false, error:'phone invalid' });
      if(!orderId)  return res.status(400).json({ ok:false, error:'orderId missing' });

      const store = loadOtpStore();
      cleanupExpiredOtps(store);

      const key = otpKey(phone972, orderId);
      const code = randomOtpCode();
      const expiresAt = Date.now() + OTP_EXPIRE_MINUTES*60*1000;

      store[key] = { code, expiresAt, createdAt: Date.now(), attempts: 0 };
      saveOtpStore(store);

      // מכניס שורה חדשה לאקסס כדי שהבוט ישלח בוואטסאפ
      const message =
`קוד אימות להמשך תשלום: ${code}
(בתוקף ל-${OTP_EXPIRE_MINUTES} דקות)
מס׳ הזמנה: ${orderId}

הטאבון – קריית ארבע חברון 🍕`;

      runAccess('insert', {
        DelayMinut: OTP_DELAY_MINUTES,
        SMSPhone: phone972,         // אנחנו שומרים 972xxxxxxxxx
        SMSData: message,
        dtDate: makeDtDateNow(),
        smsType: OTP_SMS_TYPE
      });

      console.log(`✅ OTP נוצר ונשלח | phone=${phone972} | order=${orderId} | code=${code}`);

      return res.json({ ok:true, sent:true, expiresInSeconds: OTP_EXPIRE_MINUTES*60 });

    } catch(e){
      console.error('❌ /otp/request error:', e.message);
      return res.status(500).json({ ok:false, error:e.message });
    }
  });

  // אימות קוד OTP
  // body: { phone:"05...", orderId:"12345", code:"123456" }
  app.post('/otp/verify', (req,res) => {
    try{
      const phone972 = normalizePhoneDigits(req.body?.phone);
      const orderId = String(req.body?.orderId || '').trim();
      const code = String(req.body?.code || '').trim();

      if(!phone972) return res.status(400).json({ ok:false, error:'phone invalid' });
      if(!orderId)  return res.status(400).json({ ok:false, error:'orderId missing' });
      if(!/^\d{4,8}$/.test(code)) return res.status(400).json({ ok:false, error:'code invalid' });

      const store = loadOtpStore();
      cleanupExpiredOtps(store);

      const key = otpKey(phone972, orderId);
      const rec = store[key];

      if(!rec) return res.json({ ok:false, verified:false, reason:'not_found_or_expired' });

      if(Date.now() > rec.expiresAt){
        delete store[key];
        saveOtpStore(store);
        return res.json({ ok:false, verified:false, reason:'expired' });
      }

      rec.attempts = (rec.attempts || 0) + 1;

      if(rec.attempts > 10){
        delete store[key];
        saveOtpStore(store);
        return res.json({ ok:false, verified:false, reason:'too_many_attempts' });
      }

      if(String(rec.code) !== code){
        store[key] = rec;
        saveOtpStore(store);
        return res.json({ ok:false, verified:false, reason:'wrong_code' });
      }

      // הצלחה -> מוחקים כדי שלא ישתמשו שוב
      delete store[key];
      saveOtpStore(store);

      console.log(`✅ OTP אומת בהצלחה | phone=${phone972} | order=${orderId}`);
      return res.json({ ok:true, verified:true });

    } catch(e){
      console.error('❌ /otp/verify error:', e.message);
      return res.status(500).json({ ok:false, error:e.message });
    }
  });

  app.listen(OTP_SERVER_PORT, () => {
    console.log(`✅ OTP Server running: http://localhost:${OTP_SERVER_PORT}`);
  });
}

/* =========================== */

const client = new Client({
  authStrategy: new LocalAuth({ clientId:'access-bot' }),
  puppeteer: { headless:false, args:['--no-sandbox'] }
});

client.on('qr', qr => {
  console.log('סרוק QR:');
  qrcode.generate(qr, { small:true });
});

client.on('authenticated', () => console.log('✅ authenticated (התחברות נשמרה)'));
client.on('auth_failure', (msg) => console.log('❌ auth_failure:', msg));

client.on('ready', async () => {
  console.log('✅ WhatsApp מוכן');

  // מפעילים את שרת ה-OTP המקומי
  startOtpServer();

  // בדיקת Access פעם אחת בתחילת הריצה
  try {
    runAccess('fetch');
    console.log('✅ חיבור ל-Access דרך access.ps1 תקין');
  } catch(e) {
    console.error('❌ access.ps1 לא עובד:', e.message);
    process.exit(1);
  }

  while(true){
    try{
      const res = runAccess('fetch');
      const jobs = Array.isArray(res.rows) ? res.rows : [];

      if(!jobs.length){
        await sleep(POLL_MS);
        continue;
      }

      for(const job of jobs){
        try{
          const original = String(job.SMSData || '');
          const transformed = transformMessage(original);

          console.log('📨 תוכן הודעה שעומדת להישלח:');
          console.log('--------------------------------------------------');
          console.log(transformed);
          console.log('--------------------------------------------------');

          const waId = normalizeToWhatsAppId(job.SMSPhone);
          if(!waId){
            console.log(`⚠️ מספר לא תקין | ${job.SMSPhone} | dtDate=${job.dtDate}`);
            continue;
          }

          const registered = await client.isRegisteredUser(waId);
          if(!registered){
            runAccess('nowa', {
              dtDate: job.dtDate,
              SMSPhone: job.SMSPhone,
              smsType: job.smsType,
              DelayMinut: job.DelayMinut
            });
            console.log(`🚫 אין WhatsApp -> נשאר ל-SMS | ${job.SMSPhone} | dtDate=${job.dtDate}`);
            continue;
          }

          await client.sendMessage(waId, transformed);

          const mins = extractMinutesFromPreparationMessage(original);
          if(mins){
            const key = followupKey(job);
            if(!createdFollowups.has(key)){
              createdFollowups.add(key);

              runAccess('insert', {
                DelayMinut: mins,
                SMSPhone: job.SMSPhone,
                SMSData: 'ההזמנה מוכנה, נא לגשת לדלפק , בתאבון',
                dtDate: job.dtDate,
                smsType: job.smsType
              });

              console.log(`➕ נוצרה הודעה חדשה לעוד ${mins} דקות | ${job.SMSPhone} | dtDate=${job.dtDate}`);
            }
          }

          const del = runAccess('sent', {
            dtDate: job.dtDate,
            SMSPhone: job.SMSPhone,
            smsType: job.smsType,
            DelayMinut: job.DelayMinut
          });

          console.log(`✅ נשלח: ${job.SMSPhone} | dtDate=${job.dtDate} | DelayMinut=${job.DelayMinut} | smsType=${job.smsType} | deleted=${del.deleted}`);
          await sleep(300);

        } catch(inner){
          console.error('❌ שגיאה בשליחת שורה:', inner.message);
          await sleep(200);
        }
      }

      await sleep(200);

    } catch(e){
      console.error('❌ שגיאה:', e.message);
      await sleep(POLL_MS);
    }
  }
});

client.on('disconnected', (reason) => {
  console.error('❌ התנתק מ-WhatsApp:', reason);
  process.exit(1);
});

client.initialize();
