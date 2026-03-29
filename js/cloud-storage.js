// 云端存储模块 - 调用自建 API（Vercel serverless + Upstash Redis）

class CloudStorage {
  constructor(authManager) {
    this.auth = authManager;
  }

  get isAvailable() {
    return this.auth.isLoggedIn;
  }

  // 获取云端所有待办
  async getTodos() {
    const res = await fetch('/api/todos', {
      headers: this.auth.getAuthHeader()
    });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        this.auth.signOut();
        throw new Error('登录已过期，请重新登录');
      }
      throw new Error(data.error || '获取数据失败');
    }

    return data.todos || [];
  }

  // 保存所有待办到云端（全量替换）
  async saveTodos(todos) {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.auth.getAuthHeader()
      },
      body: JSON.stringify({ todos })
    });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        this.auth.signOut();
        throw new Error('登录已过期，请重新登录');
      }
      throw new Error(data.error || '保存失败');
    }
  }
}
