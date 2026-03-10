import {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  setApiBaseUrl,
} from "./barcodeScannerUtils";

describe("API base URL storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default URL when nothing is stored", () => {
    expect(getApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  it("persists a custom URL in localStorage", () => {
    const customUrl = "http://10.0.0.15:3100/new/api";

    setApiBaseUrl(customUrl);

    expect(window.localStorage.getItem("api_base_url")).toBe(customUrl);
    expect(getApiBaseUrl()).toBe(customUrl);
  });

  it("keeps the exact saved URL from localStorage", () => {
    const customUrl = "http://192.168.1.170:4000/api";

    setApiBaseUrl(customUrl);

    expect(window.localStorage.getItem("api_base_url")).toBe(customUrl);
    expect(getApiBaseUrl()).toBe(customUrl);
  });
});
