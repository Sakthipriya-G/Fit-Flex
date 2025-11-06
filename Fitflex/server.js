const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");

// Twilio optional
const USE_TWILIO = (process.env.USE_TWILIO || "false").toLowerCase() === "true";
let twilioClient = null;
if (USE_TWILIO) {
  const twilio = require("twilio");
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(PUBLIC_DIR));

// In-memory OTP store with expiry
const otpStore = new Map(); // key: phone, value: { otp, expiresAt }

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function setOtp(phone, otp, ttlMs = 5 * 60 * 1000) {
  otpStore.set(phone, { otp, expiresAt: Date.now() + ttlMs });
}

function verifyOtp(phone, otpInput) {
  const rec = otpStore.get(phone);
  if (!rec) return { ok: false, reason: "No OTP requested" };
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(phone);
    return { ok: false, reason: "OTP expired" };
  }
  if (rec.otp !== otpInput) return { ok: false, reason: "Invalid OTP" };
  otpStore.delete(phone);
  return { ok: true };
}

// API: send OTP
app.post("/api/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone is required" });

    const otp = generateOTP();
    setOtp(phone, otp);

    if (USE_TWILIO && twilioClient) {
      // real SMS via Twilio
      const from = process.env.TWILIO_PHONE_NUMBER;
      await twilioClient.messages.create({
        from,
        to: phone,
        body: `Your FitFlex OTP is: ${otp}`
      });
      return res.json({ success: true, message: "OTP sent via SMS" });
    } else {
      // demo mode: no external service; show OTP in response so you can test
      console.log(`[DEMO MODE] OTP for ${phone}: ${otp}`);
      return res.json({ success: true, message: "OTP generated (demo mode)", demoOtp: otp });
    }
  } catch (err) {
    console.error("send-otp error:", err);
    return res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

// API: verify OTP
app.post("/api/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone & OTP required" });

  const result = verifyOtp(phone, otp);
  if (result.ok) return res.json({ success: true, message: "OTP verified" });
  return res.status(400).json({ success: false, message: result.reason });
});

// Serve registration as default route
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "registration.html"));
});

// Catch-all (optional): serve 404 or redirect
app.use((req, res) => {
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`✅ FitFlex server running at http://localhost:${PORT}`);
  console.log(`USE_TWILIO=${USE_TWILIO ? "true" : "false"} (demo mode when false)`);
});
