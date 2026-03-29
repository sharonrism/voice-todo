// 主应用逻辑 - 整合所有模块

class VoiceTodoApp {
  constructor() {
    this.storage = new TodoStorage();
    this.speechRecognizer = null;
    this.todoExtractor = null;
    this.recordingTimer = null;
    this.recordingStartTime = null;
    this.undoStack = [];
    this.maxUndoSteps = 10;
    this.inputMode = 'voice'; // 'voice' | 'text'

    // proxy 模式：通过 Vercel serverless function 调用，Key 在服务端
    this.useProxy = true;

    // 认证与云端同步
    this.auth = null;
    this.cloudStorage = null;
    this.isGuestMode = false;
    this.isSyncing = false;
    this.authMode = 'login'; // 'login' | 'register'
  }

  async init() {
    console.log('初始化应用...');

    // 初始化存储
    this.storage.init();

    // 初始化认证
    await this.initAuth();

    // 初始化 AI
    this.initAI();

    // 初始化语音识别
    try {
      this.speechRecognizer = new SpeechRecognizer();
      this.setupSpeechCallbacks();
    } catch (error) {
      this.showError(error.message);
      return;
    }

    // 加载并渲染待办列表
    this.renderTodos();

    // 绑定事件
    this.bindEvents();

    console.log('应用初始化完成');
  }

  initAI() {
    const settings = this.storage.getSettings();
    let provider = settings.aiProvider;
    let apiKey = this.storage.getApiKey(provider);

    if (!apiKey || provider === 'none') {
      provider = this.useProxy ? 'proxy' : 'none';
      apiKey = null;
    }

    this.todoExtractor = new TodoExtractor(provider, apiKey, settings.polishLevel);
    this.showModeHint(provider);
  }

  // ===== 认证流程 =====

  async initAuth() {
    this.auth = new AuthManager();
    this.auth.onAuthStateChange = (event, user) => {
      this.handleAuthStateChange(event, user);
    };

    if (this.auth.isLoggedIn) {
      // 已有 token，尝试从云端同步（同时验证 token 是否有效）
      this.cloudStorage = new CloudStorage(this.auth);
      try {
        await this.syncFromCloud();
        this.updateUserBar();
      } catch (e) {
        // Token 过期或无效
        console.error('会话已失效:', e);
        this.auth.signOut();
        this.cloudStorage = null;
        this.showLoginPrompt();
      }
    } else {
      // 未登录：默认进入本地模式，让用户先体验
      this.isGuestMode = true;
      this.showLoginPrompt();
    }
  }

  async handleAuthStateChange(event, user) {
    if (event === 'SIGNED_IN' && user) {
      this.isGuestMode = false;
      localStorage.removeItem('auth-guest-mode');
      this.cloudStorage = new CloudStorage(this.auth);
      this.hideAuthOverlay();
      this.updateUserBar();

      await this.migrateLocalToCloud();
      this.renderTodos();
      this.showMessage(`欢迎，${user.email}`);
    } else if (event === 'SIGNED_OUT') {
      this.cloudStorage = null;
      this.updateUserBar();
    }
  }

  showAuthOverlay() {
    document.getElementById('auth-overlay').style.display = 'flex';
    this.authMode = 'login';
    this.updateAuthUI();
  }

  hideAuthOverlay() {
    document.getElementById('auth-overlay').style.display = 'none';
  }

  toggleAuthMode() {
    this.authMode = this.authMode === 'login' ? 'register' : 'login';
    this.updateAuthUI();
  }

  updateAuthUI() {
    const title = document.getElementById('auth-title');
    const submit = document.getElementById('auth-submit');
    const switchText = document.getElementById('auth-switch-text');
    const switchBtn = document.getElementById('auth-switch-btn');

    if (this.authMode === 'login') {
      title.textContent = '登录';
      submit.textContent = '登录';
      switchText.textContent = '还没有账号？';
      switchBtn.textContent = '注册';
    } else {
      title.textContent = '注册';
      submit.textContent = '创建账号';
      switchText.textContent = '已有账号？';
      switchBtn.textContent = '登录';
    }
    document.getElementById('auth-error').style.display = 'none';
  }

  async handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    const submitBtn = document.getElementById('auth-submit');

    if (!email || !password) return;

    submitBtn.disabled = true;
    submitBtn.textContent = this.authMode === 'login' ? '登录中...' : '注册中...';
    errorEl.style.display = 'none';

    try {
      if (this.authMode === 'login') {
        await this.auth.signIn(email, password);
      } else {
        await this.auth.signUp(email, password);
      }
    } catch (error) {
      errorEl.textContent = this.translateAuthError(error.message);
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this.authMode === 'login' ? '登录' : '创建账号';
    }
  }

  translateAuthError(message) {
    const errorMap = {
      'Invalid login credentials': '邮箱或密码不正确',
      'User already registered': '该邮箱已注册，请直接登录',
      'Password should be at least 6 characters': '密码至少需要6位',
      'Unable to validate email address: invalid format': '邮箱格式不正确',
      'Email rate limit exceeded': '操作过于频繁，请稍后再试',
      'Signup requires a valid password': '请输入有效密码'
    };
    return errorMap[message] || `错误: ${message}`;
  }

  skipLogin() {
    this.isGuestMode = true;
    localStorage.setItem('auth-guest-mode', 'true');
    this.hideAuthOverlay();
    this.showLoginPrompt();
    this.showMessage('本地模式：数据仅保存在当前浏览器');
  }

  showLoginPrompt() {
    const el = document.getElementById('login-prompt');
    if (el) el.style.display = 'inline-block';
  }

  hideLoginPrompt() {
    const el = document.getElementById('login-prompt');
    if (el) el.style.display = 'none';
  }

  updateUserBar() {
    const userBar = document.getElementById('user-bar');
    const emailEl = document.getElementById('user-email');
    if (this.auth?.isLoggedIn) {
      userBar.style.display = 'flex';
      emailEl.textContent = this.auth.userEmail;
      this.hideLoginPrompt();
    } else {
      userBar.style.display = 'none';
    }
  }

  logout() {
    if (!confirm('确定要退出登录吗？\n退出后数据仍保留在本地。')) return;
    this.auth.signOut();
    this.cloudStorage = null;
    this.isGuestMode = true;
    this.updateUserBar();
    this.showLoginPrompt();
    this.showMessage('已退出登录');
  }

  // ===== 数据同步 =====

  async migrateLocalToCloud() {
    if (!this.cloudStorage?.isAvailable) return;

    const localTodos = this.storage.getTodos();
    if (localTodos.length === 0) return;

    try {
      this.showLoading('正在同步数据...');
      // 拉取云端数据，合并后保存
      const cloudTodos = await this.cloudStorage.getTodos();
      const merged = this.mergeTodos(localTodos, cloudTodos);
      this.storage.replaceAllTodos(merged);
      await this.cloudStorage.saveTodos(merged);
    } catch (error) {
      console.error('迁移失败:', error);
      this.showError('数据同步失败');
    } finally {
      this.hideLoading();
    }
  }

  async syncFromCloud() {
    if (!this.cloudStorage?.isAvailable || this.isSyncing) return;

    this.isSyncing = true;
    try {
      const cloudTodos = await this.cloudStorage.getTodos();
      const localTodos = this.storage.getTodos();
      const merged = this.mergeTodos(localTodos, cloudTodos);
      this.storage.replaceAllTodos(merged);
    } catch (error) {
      console.error('云端同步失败:', error);
      throw error; // 让调用者知道同步失败
    } finally {
      this.isSyncing = false;
    }
  }

  mergeTodos(localTodos, cloudTodos) {
    const merged = new Map();

    // 云端优先
    for (const todo of cloudTodos) {
      merged.set(todo.id, todo);
    }

    // 本地独有的补充进去
    for (const todo of localTodos) {
      if (!merged.has(todo.id)) {
        merged.set(todo.id, todo);
      }
    }

    return Array.from(merged.values());
  }

  async syncNow() {
    if (!this.cloudStorage?.isAvailable) {
      this.showError('请先登录');
      return;
    }

    try {
      this.showLoading('正在同步...');

      const localTodos = this.storage.getTodos();
      const cloudTodos = await this.cloudStorage.getTodos();
      const merged = this.mergeTodos(localTodos, cloudTodos);
      this.storage.replaceAllTodos(merged);
      await this.cloudStorage.saveTodos(merged);

      this.renderTodos();
      this.showMessage('同步完成');
    } catch (error) {
      this.showError('同步失败: ' + error.message);
    } finally {
      this.hideLoading();
    }
  }

  // 全量同步到云端（fire-and-forget）
  syncToCloud() {
    if (!this.cloudStorage?.isAvailable) return;
    const todos = this.storage.getTodos();
    this.cloudStorage.saveTodos(todos).catch(e =>
      console.error('云端同步失败:', e)
    );
  }

  // 显示当前模式提示
  showModeHint(provider) {
    const providerNames = {
      'none': '简单模式',
      'proxy': 'AI 模式',
      'gemini': 'Gemini AI 模式',
      'claude': 'Claude AI 模式'
    };
    const name = providerNames[provider] || '简单模式';
    console.log(`当前模式: ${name}`);

    if (provider !== 'none') {
      this.showMessage(`已接入 ${name}，语音识别结果将由 AI 智能优化`);
    }
  }

  // 设置语音识别回调
  setupSpeechCallbacks() {
    this.speechRecognizer.onInterimResult = (text) => {
      this.showRecognitionText(text, false);
      this.updateWordCount(text);
    };

    this.speechRecognizer.onFinalResult = async (text) => {
      this.showRecognitionText(text, true);
      this.stopRecordingTimer();
      await this.confirmAndProcessSpeech(text);
    };

    this.speechRecognizer.onError = (errorMessage) => {
      this.showError(errorMessage);
      this.updateVoiceButtonState('idle');
      this.stopRecordingTimer();
    };

    this.speechRecognizer.onStatusChange = (status) => {
      this.updateVoiceButtonState(status);
      if (status === 'listening') {
        this.startRecordingTimer();
      } else {
        this.stopRecordingTimer();
      }
    };
  }

  // 确认并处理语音文本
  async confirmAndProcessSpeech(text) {
    const settings = this.storage.getSettings();
    let finalText = text;

    if (settings.enableEditing) {
      const confirmed = confirm(
        `识别结果：\n\n"${text}"\n\n点击"确定"继续处理，点击"取消"可以重新编辑`
      );

      if (!confirmed) {
        const edited = prompt('请编辑识别结果：', text);
        if (!edited || !edited.trim()) {
          this.showRecognitionText('点击麦克风开始说话…', false);
          return;
        }
        finalText = edited.trim();
        this.showRecognitionText(finalText, true);
      }
    }

    await this.processSpeechText(finalText);
  }

  // 处理语音识别文本
  async processSpeechText(text) {
    const isAI = this.todoExtractor.useAI;
    this.showLoading(isAI ? 'AI 正在优化和分析...' : '正在分析待办事项...');

    try {
      const result = await this.todoExtractor.processVoiceText(text);

      // 如果 AI 修正了文本，显示修正结果
      if (isAI && result.correctedText && result.correctedText !== text) {
        console.log('AI 修正文本:', result.correctedText);
        this.showRecognitionText(`✨ ${result.correctedText}`, true);
      }

      if (result.todos.length === 0) {
        this.showMessage('没有识别到待办事项，请重新描述');
        this.showRecognitionText('点击麦克风开始说话…', false);
        return;
      }

      // 添加所有提取的待办
      for (const todo of result.todos) {
        this.storage.addTodo(todo);
      }

      this.syncToCloud();
      this.renderTodos();

      const message = result.todos.length === 1
        ? `成功添加待办: ${result.todos[0].title}`
        : `成功添加 ${result.todos.length} 个待办事项`;
      this.showMessage(message);

      // 延迟重置识别文本（让用户看到 AI 修正结果）
      setTimeout(() => {
        this.showRecognitionText('点击麦克风开始说话…', false);
      }, isAI ? 3000 : 0);

    } catch (error) {
      console.error('处理失败:', error);
      this.showError('处理失败: ' + error.message);
    } finally {
      this.hideLoading();
    }
  }

  // 渲染待办列表
  renderTodos() {
    const todos = this.storage.getTodos();

    const activeTodos = todos.filter(t => !t.completed);
    const completedTodos = todos.filter(t => t.completed);

    // 排序：先按时间（有时间的在前，时间早的在前），同一时间按优先级
    activeTodos.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };

      if (a.dueDate && b.dueDate) {
        const dateA = a.dueDate + (a.dueTime || '23:59');
        const dateB = b.dueDate + (b.dueTime || '23:59');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    const totalCount = activeTodos.length + completedTodos.length;
    const completedCount = completedTodos.length;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // 更新头部
    document.getElementById('pending-label').textContent = `${activeTodos.length} 件待办`;
    document.getElementById('completed-label').textContent = `${completedCount} 已完成`;
    document.getElementById('progress-fill').style.width = `${progressPercent}%`;
    this.updateDateLabel();

    // 渲染列表
    this.renderActiveTodos(activeTodos);
    this.renderCompletedTodos(completedTodos);
  }

  updateDateLabel() {
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const months = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
    document.getElementById('date-label').textContent =
      `周${weekDays[now.getDay()]} · ${months[now.getMonth()]}月${now.getDate()}日`;
  }

  // 优先级标签名
  getPriorityTagName(p) {
    return { high: '紧急', medium: '普通', low: '低' }[p] || '普通';
  }

  renderActiveTodos(todos) {
    const container = document.getElementById('active-todos');

    if (todos.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无待办，点击麦克风开始录音</div>';
      return;
    }

    container.innerHTML = todos.map((todo, i) => `
      <div class="task-card" data-id="${todo.id}" style="animation-delay:${0.2 + i * 0.06}s" onclick="app.toggleTodo('${todo.id}')">
        <div class="task-circle priority-${todo.priority}"></div>
        <div class="task-body">
          <div class="task-title">${this.escapeHtml(todo.title)}</div>
          ${todo.dueDate || todo.dueTime ? `<div class="task-time">${this.formatDateTime(todo.dueDate, todo.dueTime)}</div>` : ''}
        </div>
        <div class="task-actions" onclick="event.stopPropagation()">
          <button class="act-btn" onclick="app.editTodo('${todo.id}')" title="编辑">✎</button>
          <button class="act-btn act-delete" onclick="app.deleteTodo('${todo.id}')" title="删除">×</button>
        </div>
        <div class="priority-dropdown" onclick="event.stopPropagation()">
          <span class="task-tag tag-${todo.priority}" onclick="app.togglePriorityMenu('${todo.id}')">${this.getPriorityTagName(todo.priority)}</span>
          <div class="priority-menu" id="pri-menu-${todo.id}">
            <div class="priority-option ${todo.priority === 'high' ? 'selected' : ''}" onclick="app.setPriority('${todo.id}','high')"><span class="pri-dot dot-high"></span>紧急</div>
            <div class="priority-option ${todo.priority === 'medium' ? 'selected' : ''}" onclick="app.setPriority('${todo.id}','medium')"><span class="pri-dot dot-medium"></span>普通</div>
            <div class="priority-option ${todo.priority === 'low' ? 'selected' : ''}" onclick="app.setPriority('${todo.id}','low')"><span class="pri-dot dot-low"></span>低</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  renderCompletedTodos(todos) {
    const wrapper = document.getElementById('completed-wrapper');
    const container = document.getElementById('completed-todos');

    if (todos.length === 0) {
      wrapper.style.display = 'none';
      return;
    }

    wrapper.style.display = 'block';

    container.innerHTML = todos.map(todo => `
      <div class="done-card" data-id="${todo.id}" onclick="app.toggleTodo('${todo.id}')">
        <div class="done-check">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <span class="done-text">${this.escapeHtml(todo.title)}</span>
          ${todo.dueDate || todo.dueTime ? `<div class="done-time">${this.formatDateTime(todo.dueDate, todo.dueTime)}</div>` : ''}
        </div>
        <button class="done-delete" onclick="event.stopPropagation();app.deleteTodo('${todo.id}')" title="删除">×</button>
      </div>
    `).join('');
  }

  // 切换待办完成状态
  toggleTodo(id) {
    const todos = this.storage.getTodos();
    const todo = todos.find(t => t.id === id);
    if (todo) {
      this.pushUndo({ type: 'toggle', todo: JSON.parse(JSON.stringify(todo)) });
      this.storage.updateTodo(id, {
        completed: !todo.completed,
        completedAt: !todo.completed ? new Date().toISOString() : null
      });
      this.syncToCloud();
      this.renderTodos();
      this.showMessageWithUndo(todo.completed ? '待办已标记为未完成' : '待办已完成');
    }
  }

  // 删除待办
  deleteTodo(id) {
    if (confirm('确定要删除这个待办事项吗？')) {
      const todos = this.storage.getTodos();
      const todo = todos.find(t => t.id === id);
      if (todo) {
        this.pushUndo({ type: 'delete', todo: JSON.parse(JSON.stringify(todo)) });
        this.storage.deleteTodo(id);
        this.syncToCloud();
        this.renderTodos();
        this.showMessageWithUndo('待办已删除');
      }
    }
  }

  // 编辑待办
  editTodo(id) {
    const todos = this.storage.getTodos();
    const todo = todos.find(t => t.id === id);
    if (todo) {
      const newTitle = prompt('修改待办内容:', todo.title);
      if (newTitle && newTitle.trim() && newTitle.trim() !== todo.title) {
        this.pushUndo({ type: 'edit', todo: JSON.parse(JSON.stringify(todo)) });
        this.storage.updateTodo(id, { title: newTitle.trim() });
        this.syncToCloud();
        this.renderTodos();
        this.showMessageWithUndo('待办已更新');
      }
    }
  }

  // 处理文字输入
  async processTextInput() {
    const input = document.getElementById('text-input');
    const btn = document.getElementById('text-submit-btn');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    btn.disabled = true;
    await this.processSpeechText(text);
    btn.disabled = false;
  }

  // 切换输入模式
  setInputMode(mode) {
    this.inputMode = mode;
    const voiceContent = document.getElementById('voice-mode-content');
    const textContent = document.getElementById('text-input');
    const voiceBtn = document.getElementById('voice-btn');
    const textBtn = document.getElementById('text-submit-btn');

    if (mode === 'voice') {
      voiceContent.style.display = '';
      textContent.style.display = 'none';
      voiceBtn.style.display = '';
      textBtn.style.display = 'none';
    } else {
      voiceContent.style.display = 'none';
      textContent.style.display = '';
      voiceBtn.style.display = 'none';
      textBtn.style.display = '';
      textContent.focus();
    }

    // 更新下拉选中状态
    document.getElementById('mode-opt-voice').classList.toggle('selected', mode === 'voice');
    document.getElementById('mode-opt-text').classList.toggle('selected', mode === 'text');

    // 关闭下拉
    document.getElementById('mode-dropdown').style.display = 'none';
  }

  // 切换下拉菜单
  toggleModeDropdown() {
    const dropdown = document.getElementById('mode-dropdown');
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : '';
  }

  // 绑定事件
  bindEvents() {
    document.getElementById('voice-btn').addEventListener('click', () => {
      if (this.speechRecognizer.isListening) {
        this.speechRecognizer.stop();
      } else {
        this.speechRecognizer.start();
      }
    });

    document.getElementById('text-submit-btn').addEventListener('click', () => this.processTextInput());

    document.getElementById('text-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.processTextInput();
      }
    });

    document.getElementById('mode-toggle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModeDropdown();
    });

    // 点击外部关闭下拉
    document.addEventListener('click', () => {
      document.getElementById('mode-dropdown').style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
    });

    // 登录表单
    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAuthSubmit();
      });
    }
  }

  // ===== 设置菜单（重新设计）=====
  showSettingsMenu() {
    const settings = this.storage.getSettings();
    const hasKey = this.storage.hasApiKey();
    const providerNames = { 'none': '简单模式（无 AI）', 'gemini': 'Gemini AI', 'claude': 'Claude AI' };
    const currentProvider = providerNames[settings.aiProvider] || '简单模式';

    const options = [
      `当前模式：${currentProvider}`,
      '',
      '1. 设置 AI（Gemini 推荐，免费！）',
      '2. 偏好设置（润色强度等）',
      '3. 清空所有待办',
      '4. 导出数据',
      hasKey ? '5. 移除 AI Key（切换到简单模式）' : null,
      `${hasKey ? '6' : '5'}. 取消`
    ].filter(Boolean);

    const choice = prompt(options.join('\n') + '\n\n请输入选项序号:');

    switch (choice) {
      case '1':
        this.showAISetup();
        break;
      case '2':
        this.showPreferences();
        break;
      case '3':
        if (this.storage.clearAll()) {
          this.renderTodos();
          this.showMessage('所有数据已清空');
        }
        break;
      case '4':
        this.exportData();
        break;
      case '5':
        if (hasKey) {
          this.storage.clearApiKey();
          this.showMessage('已切换到简单模式');
          location.reload();
        }
        break;
    }
  }

  // AI 设置界面
  showAISetup() {
    const choice = prompt(
      '选择 AI 服务：\n\n' +
      '1. Gemini（推荐！免费 1500次/天）\n' +
      '   获取 Key: https://aistudio.google.com/apikey\n\n' +
      '2. Claude（效果最好，需付费）\n' +
      '   获取 Key: https://console.anthropic.com\n\n' +
      '3. 取消\n\n' +
      '请输入数字 1-3：'
    );

    if (choice === '1') {
      const key = prompt(
        'Gemini AI 设置\n\n' +
        '请输入你的 Gemini API Key：\n\n' +
        '获取方式：\n' +
        '1. 访问 https://aistudio.google.com/apikey\n' +
        '2. 登录 Google 账号\n' +
        '3. 点击 "Create API Key"\n' +
        '4. 复制 Key 粘贴到这里'
      );
      if (key && key.trim()) {
        this.storage.saveApiKey('gemini', key.trim());
        this.showMessage('Gemini AI 已配置！正在重新加载...');
        setTimeout(() => location.reload(), 1000);
      }
    } else if (choice === '2') {
      const key = prompt(
        'Claude AI 设置\n\n' +
        '请输入你的 Claude API Key：\n\n' +
        '获取方式：\n' +
        '1. 访问 https://console.anthropic.com\n' +
        '2. 注册并充值\n' +
        '3. 创建 API Key\n' +
        '4. 复制 Key 粘贴到这里'
      );
      if (key && key.trim()) {
        this.storage.saveApiKey('claude', key.trim());
        this.showMessage('Claude AI 已配置！正在重新加载...');
        setTimeout(() => location.reload(), 1000);
      }
    }
  }

  // 显示偏好设置
  showPreferences() {
    const settings = this.storage.getSettings();

    const editingChoice = confirm(
      `识别后编辑确认功能：\n\n当前状态：${settings.enableEditing ? '开启' : '关闭'}\n\n` +
      '开启后，语音识别完成会弹窗让你确认/编辑\n' +
      '关闭后，识别完成直接处理\n\n' +
      `点击"确定"${settings.enableEditing ? '关闭' : '开启'}此功能`
    );

    if (editingChoice) {
      settings.enableEditing = !settings.enableEditing;
      this.storage.updateSettings(settings);
      this.showMessage(`编辑确认已${settings.enableEditing ? '开启' : '关闭'}`);
    }

    const polishChoice = prompt(
      `文本润色强度设置：\n\n当前：${this.getPolishLevelName(settings.polishLevel)}\n\n` +
      '1. 低 - 仅移除时间词，保持原样\n' +
      '2. 中 - 移除口语词，适度优化（推荐）\n' +
      '3. 高 - 深度润色，转为书面语\n\n' +
      '（使用 AI 模式时，润色由 AI 完成，效果更好）\n\n' +
      '请输入数字 1-3：'
    );

    if (polishChoice) {
      const levelMap = { '1': 'low', '2': 'medium', '3': 'high' };
      const newLevel = levelMap[polishChoice];
      if (newLevel) {
        settings.polishLevel = newLevel;
        this.storage.updateSettings(settings);
        this.showMessage(`润色强度已设置为：${this.getPolishLevelName(newLevel)}`);
      }
    }
  }

  getPolishLevelName(level) {
    const names = { low: '低', medium: '中', high: '高' };
    return names[level] || '中';
  }

  // 导出数据
  exportData() {
    const data = this.storage.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-todos-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showMessage('数据已导出');
  }

  // ===== UI 辅助方法 =====

  showRecognitionText(text, isFinal) {
    const display = document.getElementById('recognition-text');
    display.textContent = text;
    display.className = isFinal ? 'recognition-text final' : 'recognition-text interim';
  }

  updateVoiceButtonState(state) {
    const btn = document.getElementById('voice-btn');
    btn.className = `voice-button ${state}`;

    // 更新波形显示
    const waves = document.getElementById('audio-waves');
    if (state === 'listening') {
      waves.style.display = 'flex';
    }
  }

  showLoading(message) {
    document.getElementById('loading').style.display = '';
    document.getElementById('loading-text').textContent = message;
  }

  hideLoading() {
    document.getElementById('loading').style.display = 'none';
  }

  showMessage(message) {
    this.showToast(message, 'success');
  }

  showError(message) {
    this.showToast(message, 'error');
  }

  showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(120%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  showMessageWithUndo(message) {
    const toast = document.createElement('div');
    toast.className = 'toast success toast-with-undo';
    toast.innerHTML = `
      <span>${message}</span>
      <button class="undo-btn" onclick="app.undo()">撤销</button>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(120%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ===== 撤销功能 =====

  undo() {
    if (this.undoStack.length === 0) {
      this.showMessage('没有可撤销的操作');
      return;
    }

    const operation = this.undoStack.pop();

    switch (operation.type) {
      case 'delete':
        this.storage.addTodo(operation.todo);
        this.syncToCloud();
        this.renderTodos();
        this.showMessage('已恢复待办');
        break;
      case 'toggle':
        this.storage.updateTodo(operation.todo.id, {
          completed: operation.todo.completed,
          completedAt: operation.todo.completedAt
        });
        this.syncToCloud();
        this.renderTodos();
        this.showMessage('已撤销');
        break;
      case 'edit':
        this.storage.updateTodo(operation.todo.id, { title: operation.todo.title });
        this.syncToCloud();
        this.renderTodos();
        this.showMessage('已恢复原内容');
        break;
    }
  }

  pushUndo(operation) {
    this.undoStack.push(operation);
    if (this.undoStack.length > this.maxUndoSteps) {
      this.undoStack.shift();
    }
  }

  // ===== 录音计时 =====

  startRecordingTimer() {
    this.recordingStartTime = Date.now();
    document.getElementById('recording-info').style.display = 'flex';
    document.getElementById('audio-waves').style.display = 'flex';
    document.getElementById('recording-duration').textContent = '00:00';
    document.getElementById('word-count').textContent = '0';

    this.recordingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      document.getElementById('recording-duration').textContent =
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
  }

  stopRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
    document.getElementById('recording-info').style.display = 'none';
    document.getElementById('audio-waves').style.display = 'none';
    this.recordingStartTime = null;
  }

  updateWordCount(text) {
    document.getElementById('word-count').textContent = text.trim().length;
  }

  // ===== 工具方法 =====

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 设置优先级
  togglePriorityMenu(id) {
    const menu = document.getElementById(`pri-menu-${id}`);
    const isOpen = menu.classList.contains('open');

    // 关闭所有已打开的菜单，恢复父卡片 z-index
    document.querySelectorAll('.priority-menu.open').forEach(m => {
      m.classList.remove('open');
      m.closest('.task-card')?.classList.remove('menu-open');
    });

    if (!isOpen) {
      menu.classList.add('open');
      // 提升父卡片的 z-index，防止被下方卡片遮挡
      menu.closest('.task-card')?.classList.add('menu-open');
      // 点击其他地方关闭
      const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
          menu.classList.remove('open');
          menu.closest('.task-card')?.classList.remove('menu-open');
          document.removeEventListener('click', closeHandler, true);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
    }
  }

  setPriority(id, priority) {
    const todos = this.storage.getTodos();
    const todo = todos.find(t => t.id === id);
    if (todo && todo.priority !== priority) {
      this.pushUndo({ type: 'edit', todo: JSON.parse(JSON.stringify(todo)) });
      this.storage.updateTodo(id, { priority });
      this.syncToCloud();
      this.renderTodos();
    }
    // 关闭菜单
    document.querySelectorAll('.priority-menu.open').forEach(m => {
      m.classList.remove('open');
      m.closest('.task-card')?.classList.remove('menu-open');
    });
  }

  // 格式化日期+时间
  formatDateTime(dateString, timeString) {
    let parts = [];
    if (dateString) {
      parts.push(this.formatDate(dateString));
    }
    if (timeString) {
      parts.push(timeString);
    }
    return parts.join(' ');
  }

  formatDate(dateString) {
    // 手动解析日期字符串，避免 new Date("YYYY-MM-DD") 按 UTC 解析的时区问题
    const parts = dateString.split('-');
    const targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    targetDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const specific = `${month}月${day}日`;
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

    if (targetDate.getTime() === today.getTime()) return `今天 · ${specific}`;
    if (targetDate.getTime() === tomorrow.getTime()) return `明天 · ${specific}`;
    if (targetDate < today) return `已过期 · ${specific}`;

    return `周${weekDays[targetDate.getDay()]} · ${specific}`;
  }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new VoiceTodoApp();
  app.init();
});
