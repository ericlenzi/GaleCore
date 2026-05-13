import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  const apiKey = sessionStorage.getItem('galecore:apiKey') || process.env.REACT_APP_API_KEY || '';
  if (apiKey) {
    config.headers['X-API-KEY'] = apiKey;
  }
  return config;
});

export default apiClient;
