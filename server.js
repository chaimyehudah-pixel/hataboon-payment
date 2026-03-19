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
const BUSINESS_ID_NUMBER_ONLY = "021957303";
const BUSINESS_WEBSITE_URL = "https://www.hataboon.co.il";
const BUSINESS_WEBSITE_DISPLAY = "www.hataboon.co.il";
const PAYMENT_HEADER_INLINE_TEXT = "הטאבון, פיצרייה ובית קפה";

const SUPPORTED_LANGS = ["he", "ru", "mizo", "en", "fr"];
const DEFAULT_LANG = "he";

const LANGUAGE_META = {
  he: { label: "עברית", htmlLang: "he", dir: "rtl" },
  ru: { label: "Русский", htmlLang: "ru", dir: "ltr" },
  mizo: { label: "Mizo", htmlLang: "lus", dir: "ltr" },
  en: { label: "English", htmlLang: "en", dir: "ltr" },
  fr: { label: "Français", htmlLang: "fr", dir: "ltr" }
};

const TRANSLATIONS = {
  he: {
    businessName: BUSINESS_NAME,
    paymentHeaderInlineText: PAYMENT_HEADER_INLINE_TEXT,
    sharePageTitle: "קישור לדף",
    shareCopied: "כתובת הדף הועתקה ללוח",
    shareFailed: "לא ניתן היה לשתף את כתובת הדף",

    businessPageTitle: BUSINESS_NAME,
    businessPageSubtitle:
      "אתר זה נועד עבור סליקת אשראי וביצוע תשלום עבור הזמנות שבוצעו טלפונית או ישירות מבית העסק",
    businessPageNotice:
      "זהו עמוד תשלום בלבד עבור הזמנות טלפונית ולא חנות אינטרנטית.<br>למעבר לחנות האינטרנטית המלאה ולצפייה בתפריט:",
    labelBusinessName: "שם העסק:",
    labelLicensedDealer: "עוסק מורשה:",
    labelBusinessPhone: "טלפון בית העסק:",
    labelBusinessAddress: "כתובת העסק:",
    labelServices: "שירותים / מוצרים:",
    servicesValue: "פיצרייה ובית קפה באיסוף עצמי, ישיבה במקום, ומשלוחים.",
    accountingTitle: "הנהלת חשבונות",
    accountingText: "הנהלת חשבונות זמינים לכם בוואטסאפ:",
    supportText:
      "לבירורים, שינוי הזמנה או בקשת סיוע ניתן ליצור קשר עם בית העסק:",
    extensionWord: "שלוחה",
    btnBusinessPage: "עמוד העסק",
    btnCancelPolicy: "מדיניות ביטולים וברורי עסקאות",
    btnCancelPolicyFinancial: "מדיניות ביטולים וברורים כספיים",

    cancelPolicyPageTitle: "מדיניות ביטולים וברורי עסקאות",
    cancelPolicyParagraph1:
      "לבקשת ביטול, שינוי הזמנה או בירור, יש להתקשר ל<strong><span class=\"nowrap-text\">{phone}</span></strong> שלוחה <strong>{ext1}</strong>. אם אין מענה אחרי חצי דקה, יש לעבור לשלוחה <strong>{ext2}</strong>.",
    cancelPolicyParagraph2:
      "בקשות לביטול עסקה, שינוי הזמנה, החזר או זיכוי ייבדקו ויטופלו בהתאם להוראות הדין החל על העסקה, סוג המוצר או השירות, ומועד הבקשה ביחס למועד הכנת ההזמנה או מסירתה.",
    cancelPolicyParagraph3:
      "בעסקאות הנוגעות להזמנת מזון שהוכנה במיוחד עבור הלקוח או שהכנתה כבר החלה, ייתכנו מגבלות על ביטול או החזר, בכפוף לדין.",
    cancelPolicyParagraph4: "במקרה של צורך בבירור כספי, ניתן לפנות גם לוואטסאפ:",
    cancelPolicyParagraph5:
      "פרטי העסק: {businessName}, {businessId}, {businessAddress}, טלפון: <span class=\"nowrap-text\">{phone}</span>.",

    paymentPageTitle: "תשלום להזמנה",
    paymentPageHeading: "תשלום להזמנה #{orderId}",
    paymentPageSubtitle: "תשלום זה מיועד להזמנה שבוצעה טלפונית או ישירות מול בית העסק.",
    labelAmount: "סכום לתשלום",
    labelFullName: "שם מלא",
    labelPhone: "טלפון",
    btnGoToPayment: "מעבר לתשלום",

    successPageTitle: "אישור תשלום",
    successTopTo: "לכבוד:",
    successTopPhone: "טלפון:",
    successTitle: "אישור תשלום",
    successPaid: "✅ התשלום עבר בהצלחה",
    receiptNumber: "מספר קבלה:",
    blockOrderPayment: "תשלום עבור הזמנה:",
    blockAmount: "סכום העסקה:",
    blockApproval: "מספר אישור מחברת האשראי:",
    blockLast4: "4 ספרות אחרונות של אמצעי התשלום:",
    btnDownloadPdf: "הורדת אישור PDF",
    btnShare: "שיתוף",

    cancelPageTitle: "התשלום בוטל",
    cancelPageHeading: "התשלום בוטל",
    cancelPageSubtitle: "לא בוצע חיוב. ניתן לבצע ניסיון נוסף במידת הצורך.",
    cancelPageNotice:
      "לביטול או בירור יש להתקשר ל-<span class=\"nowrap-text\">{phone}</span> שלוחה {ext1}. אם אין מענה אחרי חצי דקה, שלוחה {ext2}.",

    invalidOrderId: "מספר הזמנה לא תקין",
    createPaymentError: "שגיאה ביצירת תשלום",
    successPageError: "שגיאה בהצגת אישור התשלום",
    cartDescription: "תשלום להזמנה {orderId}"
  },

  ru: {
    businessName: "Pizza Hataboon",
    paymentHeaderInlineText: "Hataboon, пиццерия и кафе",
    sharePageTitle: "Ссылка на страницу",
    shareCopied: "Ссылка на страницу скопирована",
    shareFailed: "Не удалось поделиться ссылкой на страницу",

    businessPageTitle: "Pizza Hataboon",
    businessPageSubtitle:
      "Этот сайт предназначен для оплаты кредитной картой заказов, оформленных по телефону или напрямую в заведении.",
    businessPageNotice:
      "Это только страница оплаты для телефонных заказов, а не интернет-магазин.<br>Для перехода в полный интернет-магазин и просмотра меню:",
    labelBusinessName: "Название бизнеса:",
    labelLicensedDealer: "Номер бизнеса:",
    labelBusinessPhone: "Телефон:",
    labelBusinessAddress: "Адрес:",
    labelServices: "Услуги / товары:",
    servicesValue: "Пиццерия и кафе: самовывоз, посадка в заведении и доставка.",
    accountingTitle: "Бухгалтерия",
    accountingText: "По вопросам бухгалтерии можно написать в WhatsApp:",
    supportText:
      "Для уточнений, изменения заказа или получения помощи можно связаться с заведением:",
    extensionWord: "добавочный",
    btnBusinessPage: "Страница бизнеса",
    btnCancelPolicy: "Политика отмен и финансовых разъяснений",
    btnCancelPolicyFinancial: "Политика отмен и финансовых разъяснений",

    cancelPolicyPageTitle: "Политика отмен и финансовых разъяснений",
    cancelPolicyParagraph1:
      "Для отмены, изменения заказа или уточнения позвоните по номеру <strong><span class=\"nowrap-text\">{phone}</span></strong>, добавочный <strong>{ext1}</strong>. Если ответа нет в течение полуминуты, перейдите на добавочный <strong>{ext2}</strong>.",
    cancelPolicyParagraph2:
      "Запросы на отмену сделки, изменение заказа, возврат или зачисление будут рассмотрены и обработаны в соответствии с применимым законодательством, видом товара или услуги и моментом обращения относительно приготовления или передачи заказа.",
    cancelPolicyParagraph3:
      "Для заказов еды, приготовленной специально для клиента, или если приготовление уже началось, могут действовать ограничения на отмену или возврат в соответствии с законом.",
    cancelPolicyParagraph4:
      "Если требуется финансовое уточнение, можно также обратиться в WhatsApp:",
    cancelPolicyParagraph5:
      "Данные бизнеса: {businessName}, {businessId}, {businessAddress}, телефон: <span class=\"nowrap-text\">{phone}</span>.",

    paymentPageTitle: "Оплата заказа",
    paymentPageHeading: "Оплата заказа #{orderId}",
    paymentPageSubtitle:
      "Этот платеж предназначен для заказа, оформленного по телефону или напрямую в заведении.",
    labelAmount: "Сумма к оплате",
    labelFullName: "Полное имя",
    labelPhone: "Телефон",
    btnGoToPayment: "Перейти к оплате",

    successPageTitle: "Подтверждение оплаты",
    successTopTo: "Для:",
    successTopPhone: "Телефон:",
    successTitle: "Подтверждение оплаты",
    successPaid: "✅ Платёж успешно прошёл",
    receiptNumber: "Номер квитанции:",
    blockOrderPayment: "Оплата за заказ:",
    blockAmount: "Сумма операции:",
    blockApproval: "Код подтверждения от кредитной компании:",
    blockLast4: "Последние 4 цифры средства оплаты:",
    btnDownloadPdf: "Скачать подтверждение PDF",
    btnShare: "Поделиться",

    cancelPageTitle: "Платёж отменён",
    cancelPageHeading: "Платёж отменён",
    cancelPageSubtitle: "Списание не выполнено. При необходимости можно попробовать ещё раз.",
    cancelPageNotice:
      "Для отмены или уточнения позвоните по номеру <span class=\"nowrap-text\">{phone}</span>, добавочный {ext1}. Если ответа нет в течение полуминуты, добавочный {ext2}.",

    invalidOrderId: "Неверный номер заказа",
    createPaymentError: "Ошибка при создании платежа",
    successPageError: "Ошибка при отображении подтверждения оплаты",
    cartDescription: "Оплата заказа {orderId}"
  },

  mizo: {
    businessName: "Pizza Hataboon",
    paymentHeaderInlineText: "Hataboon, pizzeria leh cafe",
    sharePageTitle: "Page link",
    shareCopied: "Page address chu copy tawh a ni",
    shareFailed: "Page address hi share theih a ni lo",

    businessPageTitle: "Pizza Hataboon",
    businessPageSubtitle:
      "He website hi phone-ah emaw business hnenah direct-in order siam tawhte card hmanga payment tih nan a siam a ni.",
    businessPageNotice:
      "Hei hi phone order-te payment page chauh a ni a, online store kimchang a ni lo.<br>Online store kimchang leh menu en nan:",
    labelBusinessName: "Business hming:",
    labelLicensedDealer: "Business number:",
    labelBusinessPhone: "Phone:",
    labelBusinessAddress: "Address:",
    labelServices: "Service / thil zawrh:",
    servicesValue: "Pizzeria leh cafe: self pickup, hmunah ei, leh delivery.",
    accountingTitle: "Accounts",
    accountingText: "Accounts chungchang WhatsApp-ah contact theih:",
    supportText:
      "Zawhna, order tihdanglam emaw puihna dil nan business hnenah contact rawh:",
    extensionWord: "extension",
    btnBusinessPage: "Business page",
    btnCancelPolicy: "Cancellation policy leh finance hrilhfiahna",
    btnCancelPolicyFinancial: "Cancellation policy leh finance hrilhfiahna",

    cancelPolicyPageTitle: "Cancellation policy leh finance hrilhfiahna",
    cancelPolicyParagraph1:
      "Cancel dilna, order tihdanglam emaw zawhna atan <strong><span class=\"nowrap-text\">{phone}</span></strong> ah call la, extension <strong>{ext1}</strong>. Chhanna awm loh chuan minute chanve hnuah extension <strong>{ext2}</strong> hmang ang che.",
    cancelPolicyParagraph2:
      "Transaction cancel, order tihdanglam, refund emaw credit dilna chu law ang zelin, service/thil chi leh order siam hun nen inlaichin dan angin en fel leh ngaihtuah a ni ang.",
    cancelPolicyParagraph3:
      "Customer tan bik a siam tawh ei leh siam tan tawh order chungchangah cancel emaw refund chungchangah dan angin limit awm thei a ni.",
    cancelPolicyParagraph4:
      "Finance zawhna a awm chuan WhatsApp-ah pawh contact theih a ni:",
    cancelPolicyParagraph5:
      "Business details: {businessName}, {businessId}, {businessAddress}, phone: <span class=\"nowrap-text\">{phone}</span>.",

    paymentPageTitle: "Order payment",
    paymentPageHeading: "Order #{orderId} payment",
    paymentPageSubtitle:
      "He payment hi phone-ah emaw business hnenah direct-in order siam tawh atan a ni.",
    labelAmount: "Payment amount",
    labelFullName: "Full name",
    labelPhone: "Phone",
    btnGoToPayment: "Payment-ah kal",

    successPageTitle: "Payment confirmation",
    successTopTo: "Hnenah:",
    successTopPhone: "Phone:",
    successTitle: "Payment confirmation",
    successPaid: "✅ Payment a hlawhtling",
    receiptNumber: "Receipt number:",
    blockOrderPayment: "Order atana payment:",
    blockAmount: "Transaction amount:",
    blockApproval: "Credit company approval number:",
    blockLast4: "Payment hmang tawh thil digit hnuhnung ber 4:",
    btnDownloadPdf: "PDF confirmation download",
    btnShare: "Share",

    cancelPageTitle: "Payment tihnulh a ni",
    cancelPageHeading: "Payment tihnulh a ni",
    cancelPageSubtitle: "Charge siam a ni lo. A ngaih chuan tum leh theih a ni.",
    cancelPageNotice:
      "Cancel emaw zawhna atan <span class=\"nowrap-text\">{phone}</span> ah extension {ext1} hmangin call rawh. Chhanna awm loh chuan minute chanve hnuah extension {ext2} hmang ang che.",

    invalidOrderId: "Order number dik lo",
    createPaymentError: "Payment siam lai error a awm",
    successPageError: "Payment confirmation lantir lai error a awm",
    cartDescription: "Order {orderId} payment"
  },

  en: {
    businessName: "Hataboon Pizza",
    paymentHeaderInlineText: "Hataboon, Pizzeria & Cafe",
    sharePageTitle: "Page link",
    shareCopied: "Page link copied to clipboard",
    shareFailed: "Could not share the page link",

    businessPageTitle: "Hataboon Pizza",
    businessPageSubtitle:
      "This site is intended for credit-card payments for orders placed by phone or directly with the business.",
    businessPageNotice:
      "This is a payment page only for phone orders and not a full online store.<br>To visit the full online store and view the menu:",
    labelBusinessName: "Business name:",
    labelLicensedDealer: "Business ID:",
    labelBusinessPhone: "Business phone:",
    labelBusinessAddress: "Business address:",
    labelServices: "Services / products:",
    servicesValue: "Pizzeria and cafe with pickup, dine-in, and deliveries.",
    accountingTitle: "Accounting",
    accountingText: "For accounting matters, contact us on WhatsApp:",
    supportText:
      "For questions, order changes, or assistance, you may contact the business:",
    extensionWord: "extension",
    btnBusinessPage: "Business page",
    btnCancelPolicy: "Cancellation policy and financial clarifications",
    btnCancelPolicyFinancial: "Cancellation policy and financial clarifications",

    cancelPolicyPageTitle: "Cancellation policy and financial clarifications",
    cancelPolicyParagraph1:
      "For a cancellation request, order change, or inquiry, please call <strong><span class=\"nowrap-text\">{phone}</span></strong>, extension <strong>{ext1}</strong>. If there is no answer after half a minute, please move to extension <strong>{ext2}</strong>.",
    cancelPolicyParagraph2:
      "Requests for transaction cancellation, order changes, refunds, or credits will be reviewed and handled according to the applicable law, the type of product or service, and the timing of the request relative to the preparation or delivery of the order.",
    cancelPolicyParagraph3:
      "For food orders specially prepared for the customer, or if preparation has already begun, limitations on cancellation or refund may apply, subject to the law.",
    cancelPolicyParagraph4:
      "If financial clarification is needed, you may also contact us on WhatsApp:",
    cancelPolicyParagraph5:
      "Business details: {businessName}, {businessId}, {businessAddress}, phone: <span class=\"nowrap-text\">{phone}</span>.",

    paymentPageTitle: "Order payment",
    paymentPageHeading: "Payment for order #{orderId}",
    paymentPageSubtitle:
      "This payment is intended for an order placed by phone or directly with the business.",
    labelAmount: "Amount to pay",
    labelFullName: "Full name",
    labelPhone: "Phone",
    btnGoToPayment: "Proceed to payment",

    successPageTitle: "Payment confirmation",
    successTopTo: "To:",
    successTopPhone: "Phone:",
    successTitle: "Payment confirmation",
    successPaid: "✅ Payment completed successfully",
    receiptNumber: "Receipt number:",
    blockOrderPayment: "Payment for order:",
    blockAmount: "Transaction amount:",
    blockApproval: "Approval number from the credit company:",
    blockLast4: "Last 4 digits of the payment method:",
    btnDownloadPdf: "Download PDF confirmation",
    btnShare: "Share",

    cancelPageTitle: "Payment canceled",
    cancelPageHeading: "Payment canceled",
    cancelPageSubtitle: "No charge was made. You may try again if needed.",
    cancelPageNotice:
      "For cancellation or inquiry, please call <span class=\"nowrap-text\">{phone}</span>, extension {ext1}. If there is no answer after half a minute, extension {ext2}.",

    invalidOrderId: "Invalid order number",
    createPaymentError: "Error creating payment",
    successPageError: "Error displaying payment confirmation",
    cartDescription: "Payment for order {orderId}"
  },

  fr: {
    businessName: "Pizza Hataboon",
    paymentHeaderInlineText: "Hataboon, pizzeria et café",
    sharePageTitle: "Lien de la page",
    shareCopied: "Le lien de la page a été copié",
    shareFailed: "Impossible de partager le lien de la page",

    businessPageTitle: "Pizza Hataboon",
    businessPageSubtitle:
      "Ce site est destiné au paiement par carte bancaire pour les commandes passées par téléphone ou directement auprès du commerce.",
    businessPageNotice:
      "Ceci est uniquement une page de paiement pour les commandes téléphoniques et non une boutique en ligne complète.<br>Pour accéder à la boutique en ligne complète et voir le menu :",
    labelBusinessName: "Nom du commerce :",
    labelLicensedDealer: "Identifiant du commerce :",
    labelBusinessPhone: "Téléphone :",
    labelBusinessAddress: "Adresse :",
    labelServices: "Services / produits :",
    servicesValue: "Pizzeria et café avec retrait sur place, consommation sur place et livraisons.",
    accountingTitle: "Comptabilité",
    accountingText: "Pour la comptabilité, contactez-nous sur WhatsApp :",
    supportText:
      "Pour toute question, modification de commande ou demande d’aide, vous pouvez contacter le commerce :",
    extensionWord: "poste",
    btnBusinessPage: "Page du commerce",
    btnCancelPolicy: "Politique d’annulation et clarifications financières",
    btnCancelPolicyFinancial: "Politique d’annulation et clarifications financières",

    cancelPolicyPageTitle: "Politique d’annulation et clarifications financières",
    cancelPolicyParagraph1:
      "Pour une demande d’annulation, une modification de commande ou une question, veuillez appeler le <strong><span class=\"nowrap-text\">{phone}</span></strong>, poste <strong>{ext1}</strong>. S’il n’y a pas de réponse après trente secondes, passez au poste <strong>{ext2}</strong>.",
    cancelPolicyParagraph2:
      "Les demandes d’annulation de transaction, de modification de commande, de remboursement ou d’avoir seront examinées et traitées conformément au droit applicable, au type de produit ou de service, et au moment de la demande par rapport à la préparation ou à la remise de la commande.",
    cancelPolicyParagraph3:
      "Pour les commandes de nourriture préparées spécialement pour le client, ou si la préparation a déjà commencé, des limitations d’annulation ou de remboursement peuvent s’appliquer, sous réserve de la loi.",
    cancelPolicyParagraph4:
      "En cas de clarification financière, vous pouvez aussi nous contacter sur WhatsApp :",
    cancelPolicyParagraph5:
      "Détails du commerce : {businessName}, {businessId}, {businessAddress}, téléphone : <span class=\"nowrap-text\">{phone}</span>.",

    paymentPageTitle: "Paiement de commande",
    paymentPageHeading: "Paiement de la commande #{orderId}",
    paymentPageSubtitle:
      "Ce paiement est destiné à une commande passée par téléphone ou directement auprès du commerce.",
    labelAmount: "Montant à payer",
    labelFullName: "Nom complet",
    labelPhone: "Téléphone",
    btnGoToPayment: "Passer au paiement",

    successPageTitle: "Confirmation de paiement",
    successTopTo: "À l’attention de :",
    successTopPhone: "Téléphone :",
    successTitle: "Confirmation de paiement",
    successPaid: "✅ Le paiement a réussi",
    receiptNumber: "Numéro de reçu :",
    blockOrderPayment: "Paiement pour la commande :",
    blockAmount: "Montant de la transaction :",
    blockApproval: "Numéro d’autorisation de la société de carte :",
    blockLast4: "4 derniers chiffres du moyen de paiement :",
    btnDownloadPdf: "Télécharger la confirmation PDF",
    btnShare: "Partager",

    cancelPageTitle: "Paiement annulé",
    cancelPageHeading: "Paiement annulé",
    cancelPageSubtitle: "Aucun débit n’a été effectué. Vous pouvez réessayer si nécessaire.",
    cancelPageNotice:
      "Pour annuler ou obtenir des précisions, veuillez appeler le <span class=\"nowrap-text\">{phone}</span>, poste {ext1}. S’il n’y a pas de réponse après trente secondes, poste {ext2}.",

    invalidOrderId: "Numéro de commande invalide",
    createPaymentError: "Erreur lors de la création du paiement",
    successPageError: "Erreur lors de l’affichage de la confirmation de paiement",
    cartDescription: "Paiement de la commande {orderId}"
  }
};

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

function resolveLang(langRaw) {
  const lang = String(langRaw || "").trim().toLowerCase();
  return SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

function getLangMeta(lang) {
  return LANGUAGE_META[resolveLang(lang)] || LANGUAGE_META[DEFAULT_LANG];
}

function getTranslations(lang) {
  return TRANSLATIONS[resolveLang(lang)] || TRANSLATIONS[DEFAULT_LANG];
}

function t(lang, key, replacements = {}) {
  const dict = getTranslations(lang);
  let value = dict[key];

  if (value === undefined) {
    value = TRANSLATIONS[DEFAULT_LANG][key];
  }

  value = String(value || "");

  for (const [k, v] of Object.entries(replacements)) {
    value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }

  return value;
}

function buildUrl(path, lang, params = {}) {
  const query = new URLSearchParams();

  const safeLang = resolveLang(lang);
  if (safeLang && safeLang !== DEFAULT_LANG) {
    query.set("lang", safeLang);
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      query.set(key, String(value));
    }
  }

  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

function getRequestLang(req) {
  return resolveLang(req.query.lang || req.body?.lang || DEFAULT_LANG);
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

async function createZCreditSession({ orderId, amount, name, phone, lang }) {
  const cleanId = cleanOrderId(orderId);
  const customerName = String(name || "").trim();
  const amountNumber = parsePositiveAmount(amount);
  const phone972 = normalizePhoneDigits(phone);
  const phoneLocal = normalizePhoneLocal(phone);
  const currentLang = resolveLang(lang);

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
      encodeURIComponent(uniqueId) +
      "&lang=" +
      encodeURIComponent(currentLang),
    CancelUrl:
      BASE_URL +
      "/payment-cancel?orderId=" +
      encodeURIComponent(cleanId) +
      "&lang=" +
      encodeURIComponent(currentLang),
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
        Description: t(currentLang, "cartDescription", { orderId: cleanId }),
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

function renderLanguageBar(currentLang) {
  return `
    <div class="lang-bar" dir="ltr">
      ${SUPPORTED_LANGS.map((langCode) => {
        const meta = getLangMeta(langCode);
        const activeClass = langCode === currentLang ? " active" : "";
        return `
          <button
            type="button"
            class="lang-btn${activeClass}"
            data-lang="${htmlEscape(langCode)}"
            aria-label="${htmlEscape(meta.label)}"
          >${htmlEscape(meta.label)}</button>
        `;
      }).join("")}
    </div>
  `;
}

function renderLayout({ title, body, lang }) {
  const safeLang = resolveLang(lang);
  const meta = getLangMeta(safeLang);
  const dict = getTranslations(safeLang);

  return `
<!doctype html>
<html lang="${htmlEscape(meta.htmlLang)}" dir="${htmlEscape(meta.dir)}">
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
.lang-bar{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  justify-content:center;
  margin:0 0 18px;
}
.lang-btn{
  appearance:none;
  border:1px solid #d0d0d0;
  background:#ffffff;
  color:#111;
  border-radius:14px;
  padding:10px 14px;
  font-size:15px;
  font-weight:700;
  cursor:pointer;
  min-width:96px;
}
.lang-btn.active{
  background:#4159d1;
  color:#fff;
  border-color:#4159d1;
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
  text-align:start;
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
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
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
.share-icon{
  width:18px;
  height:18px;
  display:inline-block;
  flex:0 0 auto;
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
  .print-btn,
  .lang-bar{
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
  .lang-btn{
    min-width:unset;
    flex:1 1 calc(50% - 10px);
  }
}
</style>
<script>
const DEFAULT_LANG = ${JSON.stringify(DEFAULT_LANG)};
const SUPPORTED_LANGS = ${JSON.stringify(SUPPORTED_LANGS)};
const CURRENT_LANG = ${JSON.stringify(safeLang)};
const SHARE_PAGE_TITLE = ${JSON.stringify(dict.sharePageTitle)};
const SHARE_COPIED = ${JSON.stringify(dict.shareCopied)};
const SHARE_FAILED = ${JSON.stringify(dict.shareFailed)};

function normalizeLang(lang) {
  const value = String(lang || "").toLowerCase().trim();
  return SUPPORTED_LANGS.includes(value) ? value : DEFAULT_LANG;
}

function withLang(url, lang) {
  const targetLang = normalizeLang(lang);
  const full = new URL(url, window.location.origin);
  if (targetLang === DEFAULT_LANG) {
    full.searchParams.delete("lang");
  } else {
    full.searchParams.set("lang", targetLang);
  }
  return full.pathname + full.search + full.hash;
}

async function shareCurrentPage() {
  const url = window.location.href;

  try {
    if (navigator.share) {
      await navigator.share({
        title: document.title || SHARE_PAGE_TITLE,
        url
      });
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      alert(SHARE_COPIED);
      return;
    }

    const tempInput = document.createElement("input");
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
    alert(SHARE_COPIED);
  } catch (err) {
    alert(SHARE_FAILED);
  }
}

function persistLang(lang) {
  try {
    localStorage.setItem("siteLang", normalizeLang(lang));
  } catch (err) {}
}

function readStoredLang() {
  try {
    return normalizeLang(localStorage.getItem("siteLang") || DEFAULT_LANG);
  } catch (err) {
    return DEFAULT_LANG;
  }
}

function applyLangToLinks(lang) {
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:") || href.startsWith("#")) {
      return;
    }
    a.setAttribute("href", withLang(href, lang));
  });
}

function applyLangToForms(lang) {
  document.querySelectorAll("form").forEach((form) => {
    let input = form.querySelector('input[name="lang"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "lang";
      form.appendChild(input);
    }
    input.value = normalizeLang(lang);
  });
}

function bindLanguageButtons() {
  document.querySelectorAll(".lang-btn[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = normalizeLang(btn.getAttribute("data-lang"));
      persistLang(lang);
      window.location.href = withLang(window.location.href, lang);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const storedLang = readStoredLang();
  const currentUrl = new URL(window.location.href);

  if (!currentUrl.searchParams.get("lang")) {
    if (storedLang && storedLang !== DEFAULT_LANG) {
      window.location.replace(withLang(window.location.href, storedLang));
      return;
    }
  } else {
    persistLang(CURRENT_LANG);
  }

  applyLangToLinks(CURRENT_LANG);
  applyLangToForms(CURRENT_LANG);
  bindLanguageButtons();
});
</script>
</head>
<body>
<div class="card">
  ${renderLanguageBar(safeLang)}
  ${body}
</div>
</body>
</html>
`;
}

function renderHeaderMini(lang, options = {}) {
  const {
    showDateTimeLine = false,
    dateValue = new Date()
  } = options;

  const dt = formatIsraelDateTimeParts(dateValue);

  return `
    <div class="top-area">
      <div class="logo">
        <img src="/logo.jpeg" alt="${htmlEscape(t(lang, "businessName"))}">
      </div>
      <div class="address-line">
        ${htmlEscape(BUSINESS_STREET)} &nbsp;&nbsp; ${htmlEscape(BUSINESS_ADDRESS)}
      </div>
      <div class="inline-business-bar">
        ${htmlEscape(t(lang, "paymentHeaderInlineText"))}
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

function renderBusinessInfoPage(lang) {
  return renderLayout({
    lang,
    title: t(lang, "businessPageTitle"),
    body: `
      ${renderHeaderMini(lang)}
      <h1>${htmlEscape(t(lang, "businessName"))}</h1>
      <div class="subtitle">
        ${t(lang, "businessPageSubtitle")}
      </div>

      <div class="notice">
        ${t(lang, "businessPageNotice")} ${renderWebsiteLink()}
      </div>

      <ul class="info-list">
        <li><strong>${htmlEscape(t(lang, "labelBusinessName"))}</strong> ${htmlEscape(t(lang, "businessName"))}</li>
        <li><strong>${htmlEscape(t(lang, "labelLicensedDealer"))}</strong> ${htmlEscape(BUSINESS_ID_NUMBER_ONLY)}</li>
        <li><strong>${htmlEscape(t(lang, "labelBusinessPhone"))}</strong> <span class="nowrap-text">${htmlEscape(BUSINESS_PHONE_DISPLAY)}</span></li>
        <li><strong>${htmlEscape(t(lang, "labelBusinessAddress"))}</strong> ${htmlEscape(BUSINESS_FULL_ADDRESS)}</li>
        <li><strong>${htmlEscape(t(lang, "labelServices"))}</strong> ${htmlEscape(t(lang, "servicesValue"))}</li>
      </ul>

      <div class="notice">
        <strong>${htmlEscape(t(lang, "accountingTitle"))}</strong><br>
        ${t(lang, "accountingText")} ${renderWhatsAppLink()}
      </div>

      <div class="small-center">
        ${t(lang, "supportText")}
        <span class="nowrap-text">${htmlEscape(BUSINESS_CANCEL_PHONE_DISPLAY)}</span>
        ${htmlEscape(t(lang, "extensionWord"))} ${htmlEscape(BUSINESS_CANCEL_EXT_1)}
      </div>

      <div class="footer-buttons">
        <a class="btn secondary" href="${buildUrl("/cancel-policy", lang)}">${htmlEscape(t(lang, "btnCancelPolicy"))}</a>
      </div>
    `
  });
}

function renderCancelPolicyPage(lang) {
  return renderLayout({
    lang,
    title: t(lang, "cancelPolicyPageTitle"),
    body: `
      ${renderHeaderMini(lang)}
      <h1>${htmlEscape(t(lang, "cancelPolicyPageTitle"))}</h1>

      <p style="font-size:18px; line-height:1.8; text-align:start;">
        ${t(lang, "cancelPolicyParagraph1", {
          phone: htmlEscape(BUSINESS_CANCEL_PHONE_DISPLAY),
          ext1: htmlEscape(BUSINESS_CANCEL_EXT_1),
          ext2: htmlEscape(BUSINESS_CANCEL_EXT_2)
        })}
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:start;">
        ${t(lang, "cancelPolicyParagraph2")}
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:start;">
        ${t(lang, "cancelPolicyParagraph3")}
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:start;">
        ${t(lang, "cancelPolicyParagraph4")}
        ${renderWhatsAppLink()}
      </p>

      <p style="font-size:18px; line-height:1.8; text-align:start;">
        ${t(lang, "cancelPolicyParagraph5", {
          businessName: htmlEscape(t(lang, "businessName")),
          businessId: htmlEscape(BUSINESS_ID_LABEL),
          businessAddress: htmlEscape(BUSINESS_FULL_ADDRESS),
          phone: htmlEscape(BUSINESS_PHONE_DISPLAY)
        })}
      </p>

      <div class="footer-buttons">
        <a class="btn secondary" href="${buildUrl("/", lang)}">${htmlEscape(t(lang, "btnBusinessPage"))}</a>
      </div>
    `
  });
}

function renderPaymentPage({ orderId, amount, phone, lang }) {
  return renderLayout({
    lang,
    title: t(lang, "paymentPageTitle"),
    body: `
      ${renderHeaderMini(lang)}
      <h1>${htmlEscape(t(lang, "paymentPageHeading", { orderId }))}</h1>
      <div class="subtitle">
        ${t(lang, "paymentPageSubtitle")}
      </div>

      <form method="POST" action="/create-session">
        <input type="hidden" name="orderId" value="${htmlEscape(orderId)}">
        <input type="hidden" name="lang" value="${htmlEscape(resolveLang(lang))}">

        <label>${htmlEscape(t(lang, "labelAmount"))}</label>
        <input name="amount" value="${htmlEscape(amount)}" inputmode="decimal" required>

        <label>${htmlEscape(t(lang, "labelFullName"))}</label>
        <input name="name" autocomplete="name" required>

        <label>${htmlEscape(t(lang, "labelPhone"))}</label>
        <input name="phone" value="${htmlEscape(phone)}" inputmode="tel" autocomplete="tel" required>

        <button type="submit">${htmlEscape(t(lang, "btnGoToPayment"))}</button>
      </form>

      <div class="footer-buttons">
        <a class="btn secondary" href="${buildUrl("/", lang)}">${htmlEscape(t(lang, "btnBusinessPage"))}</a>
        <a class="btn secondary" href="${buildUrl("/cancel-policy", lang)}">${htmlEscape(t(lang, "btnCancelPolicy"))}</a>
      </div>
    `
  });
}

function renderSuccess({ receipt, orderIdFromUrl, lang }) {
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
    lang,
    title: t(lang, "successPageTitle"),
    body: `
      ${renderHeaderMini(lang, {
        showDateTimeLine: true,
        dateValue: transactionDateTime || new Date()
      })}

      <div class="receipt-wrap">
        <div class="receipt-top-details">
          <div class="receipt-top-row">
            <span class="receipt-top-label">${htmlEscape(t(lang, "successTopTo"))}</span>
            <span class="receipt-top-value">${htmlEscape(customerName)}</span>
          </div>
          <div class="receipt-top-row">
            <span class="receipt-top-label">${htmlEscape(t(lang, "successTopPhone"))}</span>
            <span class="receipt-top-value nowrap-text">${htmlEscape(phone)}</span>
          </div>
        </div>

        <div class="receipt-header">
          <div class="receipt-title">${htmlEscape(t(lang, "successTitle"))}</div>
          <div class="success-title">${htmlEscape(t(lang, "successPaid"))}</div>
          <div class="receipt-id">${htmlEscape(BUSINESS_ID_LABEL)}</div>
          ${receiptSerial ? `<div class="receipt-serial">${htmlEscape(t(lang, "receiptNumber"))} ${htmlEscape(receiptSerial)}</div>` : ""}
        </div>

        ${block(t(lang, "blockOrderPayment"), effectiveOrderId)}
        ${block(t(lang, "blockAmount"), amount ? amount + " ₪" : "")}
        ${block(t(lang, "blockApproval"), approval)}
        ${block(t(lang, "blockLast4"), paymentLast4, "nowrap-text")}

        <button type="button" class="print-btn" onclick="window.print()">${htmlEscape(t(lang, "btnDownloadPdf"))}</button>
        <button type="button" class="print-btn" onclick="shareCurrentPage()">
          <svg class="share-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 3L21 10L14 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M21 10H10C6.68629 10 4 12.6863 4 16V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${htmlEscape(t(lang, "btnShare"))}</span>
        </button>

        <div class="footer-buttons">
          <a class="btn secondary" href="${buildUrl("/", lang)}">${htmlEscape(t(lang, "btnBusinessPage"))}</a>
          <a class="btn secondary" href="${buildUrl("/cancel-policy", lang)}">${htmlEscape(t(lang, "btnCancelPolicyFinancial"))}</a>
        </div>
      </div>
    `
  });
}

function renderCancelPage(lang) {
  return renderLayout({
    lang,
    title: t(lang, "cancelPageTitle"),
    body: `
      ${renderHeaderMini(lang)}
      <h1>${htmlEscape(t(lang, "cancelPageHeading"))}</h1>
      <div class="subtitle">${htmlEscape(t(lang, "cancelPageSubtitle"))}</div>

      <div class="notice">
        ${t(lang, "cancelPageNotice", {
          phone: htmlEscape(BUSINESS_CANCEL_PHONE_DISPLAY),
          ext1: htmlEscape(BUSINESS_CANCEL_EXT_1),
          ext2: htmlEscape(BUSINESS_CANCEL_EXT_2)
        })}
      </div>

      <div class="footer-buttons">
        <a class="btn secondary" href="${buildUrl("/", lang)}">${htmlEscape(t(lang, "btnBusinessPage"))}</a>
        <a class="btn secondary" href="${buildUrl("/cancel-policy", lang)}">${htmlEscape(t(lang, "btnCancelPolicyFinancial"))}</a>
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
  const lang = getRequestLang(req);
  res.send(renderBusinessInfoPage(lang));
});

app.get("/business-info", (req, res) => {
  const lang = getRequestLang(req);
  res.send(renderBusinessInfoPage(lang));
});

app.get("/cancel-policy", (req, res) => {
  const lang = getRequestLang(req);
  res.send(renderCancelPolicyPage(lang));
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/pay/:phone/:orderId/:amount", (req, res) => {
  const lang = getRequestLang(req);
  const phone = normalizePhoneLocal(req.params.phone);
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId && orderId !== "0") {
    return res.status(400).send(t(lang, "invalidOrderId"));
  }

  res.send(renderPaymentPage({ orderId: orderId || "0", amount, phone, lang }));
});

app.get("/pay/:orderId/:amount", (req, res) => {
  const lang = getRequestLang(req);
  const orderId = cleanOrderId(req.params.orderId);
  const amount = req.params.amount;

  if (!orderId && orderId !== "0") {
    return res.status(400).send(t(lang, "invalidOrderId"));
  }

  res.send(renderPaymentPage({ orderId: orderId || "0", amount, phone: "", lang }));
});

app.post("/create-session", async (req, res) => {
  const lang = getRequestLang(req);

  try {
    const { orderId, amount, name, phone } = req.body;

    const sessionUrl = await createZCreditSession({
      orderId,
      amount,
      name,
      phone,
      lang
    });

    res.redirect(sessionUrl);
  } catch (err) {
    console.error(err);
    res.status(500).send(t(lang, "createPaymentError"));
  }
});

app.all("/zc-callback", handleZcCallback);

app.get("/payment-success", async (req, res) => {
  const lang = getRequestLang(req);

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

    res.send(renderSuccess({ receipt, orderIdFromUrl, lang }));
  } catch (err) {
    console.error("payment-success error:", err);
    res.status(500).send(t(lang, "successPageError"));
  }
});

app.get("/payment-cancel", (req, res) => {
  const lang = getRequestLang(req);
  res.send(renderCancelPage(lang));
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
