const fs = require("fs");
const nodemailer = require("nodemailer");
const { stockLensScannerConfigPaths } = require("../../../../shared/config/paths");

const CENTRAL_SMTP_FROM_FILE = stockLensScannerConfigPaths.centralSmtpFromFile;
const CENTRAL_SMTP_HOST_FILE = stockLensScannerConfigPaths.centralSmtpHostFile;
const CENTRAL_SMTP_PORT_FILE = stockLensScannerConfigPaths.centralSmtpPortFile;
const CENTRAL_SMTP_USER_FILE = stockLensScannerConfigPaths.centralSmtpUserFile;
const CENTRAL_SMTP_PASS_FILE = stockLensScannerConfigPaths.centralSmtpPassFile;
const CENTRAL_SMTP_SECURE_FILE = stockLensScannerConfigPaths.centralSmtpSecureFile;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function readOptionalTextFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const value = String(raw || "").trim();
    return value || "";
  } catch {
    return "";
  }
}

function readMailConfig() {
  const hostFileValue = readOptionalTextFile(CENTRAL_SMTP_HOST_FILE);
  const portFileValue = readOptionalTextFile(CENTRAL_SMTP_PORT_FILE);
  const userFileValue = readOptionalTextFile(CENTRAL_SMTP_USER_FILE);
  const passFileValue = readOptionalTextFile(CENTRAL_SMTP_PASS_FILE);
  const secureFileValue = readOptionalTextFile(CENTRAL_SMTP_SECURE_FILE);
  const host = String(process.env.CENTRAL_SMTP_HOST || hostFileValue || "").trim();
  const portValue = String(process.env.CENTRAL_SMTP_PORT || portFileValue || "587").trim();
  const portRaw = Number(portValue || 587);
  const secure = parseBoolean(
    process.env.CENTRAL_SMTP_SECURE || secureFileValue,
    portRaw === 465
  );
  const user = String(process.env.CENTRAL_SMTP_USER || userFileValue || "").trim();
  const pass = String(process.env.CENTRAL_SMTP_PASS || passFileValue || "").trim();
  const fromFileValue = readOptionalTextFile(CENTRAL_SMTP_FROM_FILE);
  const from = String(process.env.CENTRAL_SMTP_FROM || fromFileValue || user).trim();

  return {
    configured: Boolean(host && portRaw && from),
    host,
    port: Number.isFinite(portRaw) ? Math.trunc(portRaw) : 587,
    secure,
    user,
    pass,
    from,
  };
}

function createTransport() {
  const config = readMailConfig();
  if (!config.configured) {
    throw new Error("Central SMTP is not configured");
  }

  return {
    config,
    transport: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    }),
  };
}

async function sendCentralOtpEmail({ to, otp, expiresInMinutes }) {
  const { config, transport } = createTransport();
  await transport.sendMail({
    from: config.from,
    to,
    subject: "Central login OTP",
    text: `Your Central OTP is ${otp}. It expires in ${expiresInMinutes} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #17314e;">
        <h2 style="margin-bottom: 8px;">Central login OTP</h2>
        <p style="margin-top: 0;">Use this OTP to access Central.</p>
        <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 18px 0;">${otp}</div>
        <p>This OTP expires in ${expiresInMinutes} minutes.</p>
      </div>
    `,
  });
}

module.exports = {
  readMailConfig,
  sendCentralOtpEmail,
};
