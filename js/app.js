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

    // 内置默认 Gemini API Key
    this.defaultGeminiKey = 'AIzaSyBPEj_Yas9yeQFIXUQ3BitXQp1umBbBWpk';
  }

  async init() {
    console.log('初始化应用...');

    // 初始化存储
    this.storage.init();

    // 初始化 AI：优先用户手动设置的 Key，否则用内置的 Gemini Key
    const settings = this.storage.getSettings();
    let provider = settings.aiProvider;
    let apiKey = this.storage.getApiKey(provider);

    // 如果没有手动设置，使用内置的 Gemini Key
    if (!apiKey || provider === 'none') {
      provider = 'gemini';
      apiKey = this.defaultGeminiKey;
    }

    this.todoExtractor = new TodoExtractor(provider, apiKey, settings.polishLevel);

    // 显示模式提示
    this.showModeHint(provider);

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

  // 显示当前模式提示
  showModeHint(provider) {
    const providerNames = {
      'none': '简单模式',
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
    const settings = this.storage.getSettings();
    const isAI = settings.aiProvider !== 'none';
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
          <button class="pri-btn p-high ${todo.priority === 'high' ? 'active' : ''}" onclick="app.setPriority('${todo.id}','high')" title="紧急">!</button>
          <button class="pri-btn p-medium ${todo.priority === 'medium' ? 'active' : ''}" onclick="app.setPriority('${todo.id}','medium')" title="普通">-</button>
          <button class="pri-btn p-low ${todo.priority === 'low' ? 'active' : ''}" onclick="app.setPriority('${todo.id}','low')" title="低">↓</button>
          <button class="act-btn" onclick="app.editTodo('${todo.id}')" title="编辑">✎</button>
          <button class="act-btn act-delete" onclick="app.deleteTodo('${todo.id}')" title="删除">×</button>
        </div>
        <span class="task-tag tag-${todo.priority}">${this.getPriorityTagName(todo.priority)}</span>
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
        this.renderTodos();
        this.showMessageWithUndo('待办已更新');
      }
    }
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

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
    });
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
        this.renderTodos();
        this.showMessage('已恢复待办');
        break;
      case 'toggle':
        this.storage.updateTodo(operation.todo.id, {
          completed: operation.todo.completed,
          completedAt: operation.todo.completedAt
        });
        this.renderTodos();
        this.showMessage('已撤销');
        break;
      case 'edit':
        this.storage.updateTodo(operation.todo.id, { title: operation.todo.title });
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
  setPriority(id, priority) {
    const todos = this.storage.getTodos();
    const todo = todos.find(t => t.id === id);
    if (todo && todo.priority !== priority) {
      this.pushUndo({ type: 'edit', todo: JSON.parse(JSON.stringify(todo)) });
      this.storage.updateTodo(id, { priority });
      this.renderTodos();
    }
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

    if (targetDate.getTime() === today.getTime()) return '今天';
    if (targetDate.getTime() === tomorrow.getTime()) return '明天';
    if (targetDate < today) return '已过期';

    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    return `${month}/${day}`;
  }
}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new VoiceTodoApp();
  app.init();
});
