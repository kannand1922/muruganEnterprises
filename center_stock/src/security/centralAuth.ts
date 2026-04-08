const CENTRAL_SHARED_KEY = String(import.meta.env.VITE_CENTRAL_SHARED_KEY || "7429513860174259").trim();
const CENTRAL_TOKEN_PURPOSE = "central-route-access";

function toBase64Url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

function xorCipher(text: string, key: string) {
  if (!key) {
    throw new Error("VITE_CENTRAL_SHARED_KEY must not be empty");
  }
  const output: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const value = text.charCodeAt(index) ^ key.charCodeAt(index % key.length);
    output.push(String.fromCharCode(value));
  }
  return output.join("");
}

function encryptTokenPayload(payload: string) {
  const cipherText = xorCipher(payload, CENTRAL_SHARED_KEY);
  return toBase64Url(cipherText);
}

export function decryptCentralToken(token: string) {
  const raw = fromBase64Url(token);
  return xorCipher(raw, CENTRAL_SHARED_KEY);
}

export function buildCentralAccessToken() {
  const payload = JSON.stringify({
    purpose: CENTRAL_TOKEN_PURPOSE,
    ts: Math.floor(Date.now() / 1000),
    nonce: Math.random().toString(36).slice(2, 12),
  });
  return encryptTokenPayload(payload);
}
