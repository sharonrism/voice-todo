// 认证模块 - 调用自建 API（Vercel serverless + Upstash Redis）

class AuthManager {
  constructor() {
    this.token = localStorage.getItem('auth-token');
    this.email = localStorage.getItem('auth-email');
    this.onAuthStateChange = null;
  }

  get isLoggedIn() {
    return !!this.token;
  }

  get userEmail() {
    return this.email;
  }

  async signUp(email, password) {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    this.setSession(data.token, data.email);
    return data;
  }

  async signIn(email, password) {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    this.setSession(data.token, data.email);
    return data;
  }

  setSession(token, email) {
    this.token = token;
    this.email = email;
    localStorage.setItem('auth-token', token);
    localStorage.setItem('auth-email', email);
    if (this.onAuthStateChange) {
      this.onAuthStateChange('SIGNED_IN', { email });
    }
  }

  signOut() {
    this.token = null;
    this.email = null;
    localStorage.removeItem('auth-token');
    localStorage.removeItem('auth-email');
    if (this.onAuthStateChange) {
      this.onAuthStateChange('SIGNED_OUT', null);
    }
  }

  getAuthHeader() {
    return this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
  }
}
