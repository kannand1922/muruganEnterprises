import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";

export type DiffProofPhoto = {
  base64Data: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
};

const DEFAULT_PROOF_MIME_TYPE = "image/jpeg";

function getFileExtensionForMimeType(mimeType: string) {
  switch (String(mimeType || "").trim().toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    default:
      return ".jpg";
  }
}

function getMimeTypeForFormat(format: string | null | undefined) {
  const normalized = String(format || "").trim().toLowerCase();
  if (normalized === "png") return "image/png";
  if (normalized === "webp") return "image/webp";
  if (normalized === "heic") return "image/heic";
  if (normalized === "heif") return "image/heif";
  return DEFAULT_PROOF_MIME_TYPE;
}

function buildProofFileName(mimeType: string) {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `diff-proof-${timestamp}${getFileExtensionForMimeType(mimeType)}`;
}

export async function captureDiffProofPhoto(): Promise<DiffProofPhoto> {
  const permissionState = await Camera.checkPermissions();
  if (String(permissionState.camera || "").toLowerCase() !== "granted") {
    const requested = await Camera.requestPermissions({ permissions: ["camera"] });
    if (String(requested.camera || "").toLowerCase() !== "granted") {
      throw new Error("Camera permission is required to capture proof photos.");
    }
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    direction: CameraDirection.Rear,
    resultType: CameraResultType.Base64,
    quality: 70,
    width: 1600,
    correctOrientation: true,
    saveToGallery: false,
  });

  const base64Data = String(photo.base64String || "").trim();
  if (!base64Data) {
    throw new Error("Camera did not return proof image data.");
  }

  const mimeType = getMimeTypeForFormat(photo.format);
  return {
    base64Data,
    dataUrl: `data:${mimeType};base64,${base64Data}`,
    fileName: buildProofFileName(mimeType),
    mimeType,
  };
}
