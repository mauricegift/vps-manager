import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

const LS_ACCESS = 'vpsm_access_token';
const LS_REFRESH = 'vpsm_refresh_token';

// Attach access token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem(LS_ACCESS);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

// On 401 — try to refresh once, then retry the original request
api.interceptors.response.use(
  res => res,
  async error => {
    const orig = error.config;

    // Don't retry auth endpoints to avoid loops
    if (orig?.url?.includes('/auth/')) return Promise.reject(error);

    if (error.response?.status === 401 && !orig._retry) {
      orig._retry = true;

      if (!refreshing) {
        refreshing = axios
          .post('/api/auth/refresh', { refreshToken: localStorage.getItem(LS_REFRESH) })
          .then(({ data }) => {
            if (data.success) {
              localStorage.setItem(LS_ACCESS, data.data.accessToken);
              localStorage.setItem(LS_REFRESH, data.data.refreshToken);
              return data.data.accessToken as string;
            }
            return null;
          })
          .catch(() => null)
          .finally(() => { refreshing = null; });
      }

      const newToken = await refreshing;
      if (newToken) {
        orig.headers.Authorization = `Bearer ${newToken}`;
        return api(orig);
      }

      // Both tokens dead — clear storage, notify AuthContext, redirect
      localStorage.removeItem(LS_ACCESS);
      localStorage.removeItem(LS_REFRESH);
      window.dispatchEvent(new Event('auth:session-expired'));
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export default api;
