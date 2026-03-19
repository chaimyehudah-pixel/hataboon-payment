function renderLayout(title, content, lang = "he") {

  const isRTL = lang === "he";

  return `
<!DOCTYPE html>
<html lang="${lang}" dir="${isRTL ? "rtl" : "ltr"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>

<style>
body {
  font-family: Arial, sans-serif;
  margin: 0;
  background: #f7f7f7;
}

/* HEADER */
.header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 10px 15px;
  background: white;
  border-bottom: 1px solid #ddd;
}

/* LANGUAGE SELECT */
.lang-box {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lang-select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid #ccc;
  font-size: 14px;
  cursor: pointer;
}

/* SVG ICON */
.lang-icon {
  width: 22px;
  height: 22px;
}

/* CONTENT */
.container {
  padding: 20px;
}
</style>

<script>
function setLang(l) {
  localStorage.setItem("lang", l);
  const url = new URL(window.location.href);
  url.searchParams.set("lang", l);
  window.location.href = url.toString();
}

function initLang() {
  const urlLang = new URLSearchParams(window.location.search).get("lang");
  const savedLang = localStorage.getItem("lang");

  if (!urlLang && savedLang) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", savedLang);
    window.location.href = url.toString();
  }
}
</script>

</head>

<body onload="initLang()">

<div class="header">

  <div class="lang-box">

    <!-- ICON -->
    <svg class="lang-icon" viewBox="0 0 24 24">
      <rect x="2" y="2" width="10" height="10" rx="2.5" fill="#4285F4"/>
      <text x="7" y="9" font-size="6" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold">A</text>
      <rect x="12" y="12" width="10" height="10" rx="2.5" fill="white" stroke="#DADCE0" stroke-width="1"/>
      <path d="M14 18H20" stroke="#5F6368" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M16 14C17 15 18 16.5 18 18" stroke="#5F6368" stroke-width="1.6" stroke-linecap="round"/>
    </svg>

    <!-- SELECT -->
    <select class="lang-select" onchange="setLang(this.value)">
      <option value="he">עברית</option>
      <option value="en">English</option>
      <option value="ru">Русский</option>
      <option value="fr">Français</option>
      <option value="mizo">Mizo</option>
    </select>

  </div>

</div>

<div class="container">
${content}
</div>

</body>
</html>
`;
}
