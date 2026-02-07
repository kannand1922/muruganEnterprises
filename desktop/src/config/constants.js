export const API_BASE_URL = 'http://localhost:3000';

const rawAnalysisPassword = "admin";
export const ANALYSIS_PASSWORD =
  typeof rawAnalysisPassword === 'string' ? rawAnalysisPassword : '';
