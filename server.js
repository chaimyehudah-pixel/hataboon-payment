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
  return d.slice
