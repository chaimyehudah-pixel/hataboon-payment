const express = require("express");

const app = express();

// Railway/Node behind proxies
app.set("trust proxy", true);

// Read raw body (Z-Credit may send urlencoded or xml/plain)
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

// Simple home
app.get("/", (req, res) => {
  res.type("text").send("Hataboon Payment Server Running 🚀");
});

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Debug: show which env vars exist (not values)
app.get("/debug/env", (req, res) => {
  const keys = ["ZC_TERMINAL", "ZC_PASSWORD", "ZC_KEY", "BASE_URL"];
  const has = Object.fromEntries(keys.map((k) => [k, !!process.env[k]]));
  res.json({ ok: true, has });
});

// ====== IMPORTANT: Z-Credit callback endpoint ======
app.all("/zc-callback", (req, res) => {
  // Make it impossible to miss in logs
  console.log("========== ZC CALLBACK RECEIVED ==========");
  console.log("Time:", new Date().toISOString());
  console.log("Method:", req.method);
  console.log("IP:", req.ip);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Query:", JSON.stringify(req.query, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  console.log("==========================================");

  // Always return 200 OK so Z-Credit won't retry/fail
  res.type("text").status(200).send("OK");
});

// Payment success/cancel pages (for redirect)
app.get("/payment-success", (req, res) => {
  res.type("text").send("Payment Success ✅");
});

app.get("/payment-cancel", (req, res) => {
  res.type("text").send("Payment Cancel ❌");
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
