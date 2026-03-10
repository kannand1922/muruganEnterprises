import { getApiBaseUrl } from "../components/barcodeScannerUtils";

const getBaseUrl = () => getApiBaseUrl();

export async function getProducts() {
  const response = await fetch(`${getBaseUrl()}/products`);
  if (!response.ok) throw new Error("Failed to fetch products");
  return response.json();
}

export async function getAllPrinters() {
  const response = await fetch(`${getBaseUrl()}/allprinters`);
  if (!response.ok) throw new Error("Failed to fetch printers");
  return response.json();
}

export async function getBrands() {
  const response = await fetch(`${getBaseUrl()}/brands`);
  if (!response.ok) throw new Error("Failed to fetch brands");
  return response.json();
}
