// 数据存储模块 - 封装 localStorage 操作

class TodoStorage {
  constructor() {
    this.storageKey = 'voice-todos-data';
    this.version = '1.1';
  }

  // 初始化存储结构
  init() {
    const data = this.load();
    if (!data) {
      // 首次使用，创建初始数据
      this.save({
        version: this.version,
        todos: [],
        settings: {
          aiProvider: 'none',       // AI 提供商: 'none' | 'gemini' | 'claude'
          enableEditing: false,     // 是否在识别后允许编辑（默认关闭，更流畅）
          polishLevel: 'medium'     // 润色强度: low, medium, high
        },
        lastUpdated: new Date().toISOString()
      });
    } else {
      // 数据迁移
      let needSave = false;

      if (data.settings) {
        // 迁移旧的 enableEditing 设置
        if (data.settings.enableEditing === true) {
          data.settings.enableEditing = false;
          needSave = true;
        }
        // 迁移旧版本：添加 aiProvider 字段
        if (!data.settings.aiProvider) {
          data.settings.aiProvider = data.settings.apiKeySet ? 'claude' : 'none';
          needSave = true;
        }
      }

      if (needSave) {
        this.save(data);
        console.log('数据已迁移到新版本');
      }
    }
  }

  // 获取设置
  getSettings() {
    const data = this.load();
    return data?.settings || {
      aiProvider: 'none',
      enableEditing: false,
      polishLevel: 'medium'
    };
  }

  // 更新设置
  updateSettings(newSettings) {
    const data = this.load() || { version: this.version, todos: [] };
    data.settings = { ...data.settings, ...newSettings };
    return this.save(data);
  }

  // 加载数据
  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Load data error:', error);
      return null;
    }
  }

  // 保存数据
  save(data) {
    try {
      data.lastUpdated = new Date().toISOString();
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Save data error:', error);
      if (error.name === 'QuotaExceededError') {
        alert('存储空间已满，请删除一些旧的待办事项');
      }
      return false;
    }
  }

  // 获取所有待办
  getTodos() {
    const data = this.load();
    return data ? data.todos : [];
  }

  // 保存待办列表
  saveTodos(todos) {
    const data = this.load() || { version: this.version, settings: {} };
    data.todos = todos;
    return this.save(data);
  }

  // 添加单个待办
  addTodo(todo) {
    const todos = this.getTodos();
    todos.push({
      ...todo,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null
    });
    return this.saveTodos(todos);
  }

  // 更新待办
  updateTodo(id, updates) {
    const todos = this.getTodos();
    const index = todos.findIndex(t => t.id === id);
    if (index !== -1) {
      todos[index] = { ...todos[index], ...updates };
      return this.saveTodos(todos);
    }
    return false;
  }

  // 删除待办
  deleteTodo(id) {
    const todos = this.getTodos().filter(t => t.id !== id);
    return this.saveTodos(todos);
  }

  // 生成唯一 ID
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // API Key 管理 - 支持多个 AI 提供商
  saveApiKey(provider, key) {
    sessionStorage.setItem(`ai-api-key-${provider}`, key);
    this.updateSettings({ aiProvider: provider });
  }

  getApiKey(provider) {
    if (!provider) {
      const settings = this.getSettings();
      provider = settings.aiProvider;
    }
    return sessionStorage.getItem(`ai-api-key-${provider}`);
  }

  hasApiKey(provider) {
    if (!provider) {
      const settings = this.getSettings();
      provider = settings.aiProvider;
    }
    if (provider === 'none') return false;
    return !!this.getApiKey(provider);
  }

  clearApiKey(provider) {
    if (!provider) {
      const settings = this.getSettings();
      provider = settings.aiProvider;
    }
    sessionStorage.removeItem(`ai-api-key-${provider}`);
    this.updateSettings({ aiProvider: 'none' });
  }

  // 清空所有数据
  clearAll() {
    if (confirm('确定要清空所有待办事项吗？此操作不可恢复！')) {
      localStorage.removeItem(this.storageKey);
      this.init();
      return true;
    }
    return false;
  }

  // 导出数据（用于备份）
  exportData() {
    const data = this.load();
    return JSON.stringify(data, null, 2);
  }

  // 导入数据（用于恢复）
  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.todos && Array.isArray(data.todos)) {
        this.save(data);
        return true;
      }
      throw new Error('数据格式不正确');
    } catch (error) {
      console.error('Import data error:', error);
      alert('导入失败：' + error.message);
      return false;
    }
  }
}
