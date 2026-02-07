import { API_BASE_URL } from "../config/constants";


export const cycleAPI = {
  startCycle: async () => {
    const response = await fetch(`${API_BASE_URL}/api/cycle/start`, {
      method: 'POST'
    });
    return response.json();
  },

  stopCycle: async (endDate = null, forcePassword = "") => {
    const payload = { endDate };
    if (forcePassword) {
      payload.forcePassword = forcePassword;
    }

    const response = await fetch(`${API_BASE_URL}/api/cycle/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return response.json();
  },

  getCurrentCycle: async () => {
    const response = await fetch(`${API_BASE_URL}/api/cycle/current`);
    return response.json();
  },

  getAllCycles: async () => {
    const response = await fetch(`${API_BASE_URL}/api/cycle/all`);
    return response.json();
  },

  getCycleData: async (cycleDate) => {
    const response = await fetch(`${API_BASE_URL}/api/cycle/${encodeURIComponent(cycleDate)}`);
    return response.json();
  },

  compareCycle: async (cycleDate, location, analysisDate) => {
    const params = new URLSearchParams();
    if (location) {
      params.append('location', location);
    }
    if (analysisDate) {
      params.append('analysisDate', analysisDate);
    }

    const queryString = params.toString();
    const url = `${API_BASE_URL}/api/cycle/${encodeURIComponent(cycleDate)}/compare${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url);
    return response.json();
  },

  getBestSelling: async (cycleDate, location, analysisDate) => {
    const params = new URLSearchParams();
    if (location) {
      params.append('location', location);
    }
    if (analysisDate) {
      params.append('analysisDate', analysisDate);
    }

    const queryString = params.toString();
    const url = `${API_BASE_URL}/api/cycle/${encodeURIComponent(cycleDate)}/bestselling${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url);
    return response.json();
  },

  getMissingBarcodes: async () => {
    const response = await fetch(`${API_BASE_URL}/api/brands/missing-barcodes`);
    return response.json();
  },

  getNilStock: async () => {
    const response = await fetch(`${API_BASE_URL}/api/brands/nil`);
    return response.json();
  },

  getBrands: async () => {
    const response = await fetch(`${API_BASE_URL}/api/brands`);
    return response.json();
  },

  getPrinters: async () => {
    const response = await fetch(`${API_BASE_URL}/api/allprinters`);
    return response.json();
  },

  getOperators: async () => {
    const response = await fetch(`${API_BASE_URL}/api/operators`);
    return response.json();
  },

  getBrandsStatus: async () => {
    const response = await fetch(`${API_BASE_URL}/api/brands/status`);
    return response.json();
  },

  printHtmlReport: async ({ printerIP, htmlContent, jobLabel, copies = 1, port }) => {
    const response = await fetch(`${API_BASE_URL}/api/print/html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerIP, htmlContent, jobLabel, copies, port })
    });
    return response.json();
  },

  printVerificationReport: async ({ cycleDate, location, printerIP }) => {
    const params = new URLSearchParams();
    if (location) {
      params.append('location', location);
    }
    if (printerIP) {
      params.append('printer', printerIP);
    }
    const url = `${API_BASE_URL}/api/print/verification-report/${encodeURIComponent(
      cycleDate
    )}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.json();
  },

  previewVerificationReport: async ({ cycleDate, location }) => {
    const params = new URLSearchParams();
    params.append('preview', 'true');
    if (location) {
      params.append('location', location);
    }
    const url = `${API_BASE_URL}/api/print/verification-report/${encodeURIComponent(
      cycleDate
    )}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.json();
  }
};
