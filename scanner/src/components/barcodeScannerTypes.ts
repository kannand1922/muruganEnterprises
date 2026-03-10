export interface ScannedBarcode {
  id: string;
  value: string;
  format: string;
  timestamp: Date;
  quantity: number;
}

export interface QRData {
  timestamp: string;
  count: number;
  totalQuantity: number;
  barcodes: {
    value: string;
    format: string;
    quantity: number;
    scanned_at: string;
  }[];
}

export interface Product {
  "BRAND NAME": string;
  PACK: string;
  "BARCODE VALUE": string;
}

export interface APIResponse<T> {
  success: boolean;
  count: number;
  data: T[];
}

export interface BrandItem {
  "Sl.": string;
  Item: string;
  Brand: string;
  Pack: string;
  BPC: string;
  MRP: string;
  Godown: string;
  Shop: string;
  BarCode: string;
}

export interface AddOnItem {
  "ITEM CODE": string;
  PRODUCT: string;
  PRICE:string;
}

export interface EnhancedScannedBarcode {
  id: string;
  value: string;
  format: string;
  timestamp: Date;
  quantity: number;
  productName?: string;
  brandName?: string;
  pack?: string;
  mrp?: number;
  isMatched: boolean;
}

export interface Printer {
  "PRINTER NAME": string;
  IP: string;
}

export type QuantityMode = "auto" | "prompt" | "manual";

export interface SelectedAddOn {
  itemCode: string;
  product: string;
  price: number;
  quantity: number;
  totalPrice: number;
}