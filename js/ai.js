// AI 处理模块 - 支持 Gemini / Claude / 简单模式

class TodoExtractor {
  constructor(provider = 'none', apiKey = null, polishLevel = 'medium') {
    this.provider = provider;    // 'none' | 'proxy' | 'gemini' | 'claude'
    this.apiKey = apiKey;
    this.polishLevel = polishLevel;

    // API 配置
    this.config = {
      gemini: {
        getUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        model: 'gemini-2.5-flash'
      },
      claude: {
        url: 'https://api.anthropic.com/v1/messages',
        model: 'claude-3-5-sonnet-20241022'
      }
    };
  }

  // 是否使用 AI 模式
  get useAI() {
    return this.provider === 'proxy' || (this.provider !== 'none' && this.apiKey);
  }

  // 统一的 Prompt：同时做润色 + 提取待办
  getPrompt() {
    const today = this.getDateString(0);
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()];

    return `你是一个语音识别后处理助手。用户通过语音输入了一段话，语音识别可能有错误。

任务1：修正语音识别错误（同音字、标点等），整理成通顺的句子，保持原意。
任务2：提取所有待办事项，一段话里有多个事情时必须拆分成多个独立的todo。

重要规则：
- dueDate 必须是 YYYY-MM-DD 格式的具体日期，或者 null
- dueTime 是具体时间 HH:MM 格式（24小时制），或者时间段字符串，或者 null
  - 用户说"早上" → "09:00"，"上午" → "10:00"，"中午" → "12:00"
  - "下午" → "14:00"，"晚上" → "20:00"
  - "X点" → 对应的 HH:00，"X点半" → HH:30
  - 如果没提到具体时间，dueTime 为 null
- 今天是 ${today}（周${dayOfWeek}），明天是 ${this.getDateString(1)}，后天是 ${this.getDateString(2)}
- 一段话中如果提到多件事，每件事单独一个 todo
- 优先级：紧急/重要/必须 → high，有截止时间 → medium，不紧急 → low
- 如果没有具体待办（闲聊），todos 返回空数组

示例：
输入："明天早上去健身下午三点开会还有下周五之前把报告写完"
输出：
{
  "correctedText": "明天早上去健身，下午三点开会，还有下周五之前把报告写完。",
  "todos": [
    {"title": "去健身", "priority": "medium", "dueDate": "${this.getDateString(1)}", "dueTime": "09:00"},
    {"title": "开会", "priority": "medium", "dueDate": "${this.getDateString(1)}", "dueTime": "15:00"},
    {"title": "完成报告", "priority": "high", "dueDate": "${this.getNextWeekday(5)}", "dueTime": null}
  ]
}`;
  }

  // ===== 主入口：处理语音文本 =====
  async processVoiceText(speechText) {
    if (!speechText || !speechText.trim()) {
      throw new Error('语音内容为空');
    }

    // 简单模式（无 AI）
    if (!this.useAI) {
      return {
        correctedText: speechText,
        todos: this.simpleExtract(speechText)
      };
    }

    // AI 模式
    try {
      console.log(`使用 ${this.provider} AI 处理...`, speechText);
      const result = await this.callAI(speechText);
      console.log('AI 处理结果:', result);
      return result;
    } catch (error) {
      console.error('AI 处理失败，降级到简单模式:', error);
      throw error;
    }
  }

  // ===== 调用 AI API =====
  async callAI(text) {
    if (this.provider === 'proxy') {
      return this.callProxy(text);
    } else if (this.provider === 'gemini') {
      return this.callGemini(text);
    } else if (this.provider === 'claude') {
      return this.callClaude(text);
    }
    throw new Error('未知的 AI 提供商');
  }

  // 通过 Vercel serverless proxy 调用（API Key 在服务端）
  async callProxy(text) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: this.getPrompt(),
          text: text
        })
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('AI 请求超时，请重试');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw new Error('API 调用次数超限，请稍后再试');
      }
      throw new Error(error.error || 'AI 处理失败');
    }

    const data = await response.json();
    return this.parseAIResponse(data.content);
  }

  // 调用 Gemini API
  async callGemini(text) {
    const url = this.config.gemini.getUrl(this.apiKey);

    // 15 秒超时
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${this.getPrompt()}\n\n请处理以下语音识别文本：\n\n"${text}"`
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('AI 请求超时，请重试');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 400 && error.error?.message?.includes('API key')) {
        throw new Error('Gemini API Key 无效，请检查设置');
      } else if (response.status === 429) {
        throw new Error('API 调用次数超限，请稍后再试');
      }
      throw new Error(`Gemini API 错误: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini 返回内容为空');
    }

    return this.parseAIResponse(content);
  }

  // 调用 Claude API
  async callClaude(text) {
    // 15 秒超时
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(this.config.claude.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.claude.model,
          max_tokens: 1024,
          temperature: 0.3,
          system: this.getPrompt(),
          messages: [{
            role: 'user',
            content: `请处理以下语音识别文本：\n\n"${text}"`
          }]
        })
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('AI 请求超时，请重试');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Claude API Key 无效，请检查设置');
      } else if (response.status === 429) {
        throw new Error('API 调用次数超限，请稍后再试');
      }
      throw new Error(`Claude API 错误: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;
    if (!content) {
      throw new Error('Claude 返回内容为空');
    }

    return this.parseAIResponse(content);
  }

  // 解析 AI 返回的 JSON（兼容不同 key 命名）
  parseAIResponse(content) {
    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI 返回格式错误');
      }
    }

    // 兼容不同的 key 命名
    const correctedText = result.correctedText || result.corrected_text || result.text || '';
    const todos = result.todos || result.items || [];

    if (!Array.isArray(todos)) {
      throw new Error('AI 返回数据格式不正确');
    }

    // 标准化每个 todo 的字段名
    const normalizedTodos = todos.map(todo => ({
      title: todo.title || todo.item || todo.task || todo.name || '',
      priority: todo.priority || 'medium',
      dueDate: todo.dueDate || todo.due_date || todo.date || null,
      dueTime: todo.dueTime || todo.due_time || todo.time || null
    })).filter(todo => todo.title.length > 0);

    return { correctedText, todos: normalizedTodos };
  }

  // ===== 简单模式（无 AI，使用规则提取）=====
  simpleExtract(speechText) {
    console.log('使用简单模式提取待办:', speechText);

    const text = speechText.trim();
    const todos = [];
    const items = this.splitTasks(text);

    for (const item of items) {
      const cleaned = item.trim();
      if (cleaned.length < 2) continue;

      const todo = {
        title: cleaned,
        priority: this.detectPriority(cleaned),
        dueDate: this.detectDate(cleaned)
      };

      todo.title = this.cleanTitle(todo.title);
      if (!todo.title || todo.title.length < 2) continue;

      todos.push(todo);
    }

    console.log('简单模式提取结果:', todos);
    return todos;
  }

  // 智能分割任务
  splitTasks(text) {
    if (text.length < 5) return [text];

    const strongSeparators = ['还有', '另外', '还要', '以及'];
    let parts = [text];
    for (const sep of strongSeparators) {
      const newParts = [];
      for (const part of parts) {
        newParts.push(...part.split(sep));
      }
      parts = newParts;
    }

    const finalParts = [];
    for (const part of parts) {
      if (part.includes('，') || part.includes(',')) {
        const hasTimeWords = /今天|明天|后天|大后天|周[一二三四五六日]|下周|本周|下下周|月底|月初/.test(part);

        if (hasTimeWords) {
          const segments = part.split(/[，,]/);
          let currentTask = '';

          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i].trim();
            const looksComplete = seg.length > 3 && (
              /今天|明天|后天|大后天|周[一二三四五六日]|月底|月初/.test(seg) ||
              /要|得|需要|记得|完成|做|买|打|发|写|看|问|交|去/.test(seg)
            );

            if (looksComplete) {
              if (currentTask) finalParts.push(currentTask);
              currentTask = seg;
            } else {
              currentTask += (currentTask ? '，' : '') + seg;
            }
          }
          if (currentTask) finalParts.push(currentTask);
        } else {
          finalParts.push(part);
        }
      } else {
        finalParts.push(part);
      }
    }

    return finalParts.filter(p => p.trim().length > 0);
  }

  // 检测优先级
  detectPriority(text) {
    const highKeywords = ['紧急', '必须', '重要', '赶紧', '马上', '立刻', '尽快'];
    const lowKeywords = ['有空', '可以', '想要', '打算'];

    for (const keyword of highKeywords) {
      if (text.includes(keyword)) return 'high';
    }
    for (const keyword of lowKeywords) {
      if (text.includes(keyword)) return 'low';
    }
    return 'medium';
  }

  // 检测日期（增强版）
  detectDate(text) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (text.includes('大后天')) return this.getDateString(3);
    if (text.includes('后天')) return this.getDateString(2);
    if (text.includes('明天') || text.includes('明日')) return this.getDateString(1);
    if (text.includes('今天') || text.includes('今日')) return this.getDateString(0);

    const thisMonthDayMatch = text.match(/[本这]个?月([0-9一二三四五六七八九十]+)号/);
    if (thisMonthDayMatch) {
      return this.getDateOfThisMonth(this.chineseNumberToInt(thisMonthDayMatch[1]));
    }

    const nextMonthDayMatch = text.match(/下个?月([0-9一二三四五六七八九十]+)号/);
    if (nextMonthDayMatch) {
      return this.getDateOfNextMonth(this.chineseNumberToInt(nextMonthDayMatch[1]));
    }

    if (text.includes('这个月底') || text.includes('本月底') || text.includes('月底')) {
      return this.getEndOfMonth();
    }

    if (text.includes('下个月初') || text.includes('下月初') || text.includes('下个月1号')) {
      return this.getStartOfNextMonth();
    }

    const nextNextWeekMatch = text.match(/下下周([一二三四五六日天])/);
    if (nextNextWeekMatch) {
      const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
      return this.getWeekdayAfterWeeks(dayMap[nextNextWeekMatch[1]], 2);
    }

    const nextWeekMatch = text.match(/下周([一二三四五六日天])/);
    if (nextWeekMatch) {
      const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
      return this.getNextWeekday(dayMap[nextWeekMatch[1]]);
    }

    const weekdayMatch = text.match(/[本这]周([一二三四五六日天])/);
    if (weekdayMatch) {
      const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
      return this.getThisWeekday(dayMap[weekdayMatch[1]]);
    }

    const weekdayOnlyMatch = text.match(/周([一二三四五六日天])/);
    if (weekdayOnlyMatch) {
      const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
      const targetDay = dayMap[weekdayOnlyMatch[1]];
      return targetDay <= today.getDay() ? this.getNextWeekday(targetDay) : this.getThisWeekday(targetDay);
    }

    return null;
  }

  // ===== 日期工具方法 =====

  // 使用本地时间格式化日期（修复时区问题）
  formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getDateString(offset) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return this.formatLocalDate(date);
  }

  getNextWeekday(targetDay) {
    const date = new Date();
    let daysToAdd = targetDay - date.getDay();
    if (daysToAdd <= 0) daysToAdd += 7;
    date.setDate(date.getDate() + daysToAdd);
    return this.formatLocalDate(date);
  }

  getThisWeekday(targetDay) {
    const date = new Date();
    let daysToAdd = targetDay - date.getDay();
    if (daysToAdd < 0) daysToAdd += 7;
    date.setDate(date.getDate() + daysToAdd);
    return this.formatLocalDate(date);
  }

  getWeekdayAfterWeeks(targetDay, weeks) {
    const date = new Date();
    let daysToAdd = targetDay - date.getDay();
    if (daysToAdd <= 0) daysToAdd += 7;
    daysToAdd += (weeks - 1) * 7;
    date.setDate(date.getDate() + daysToAdd);
    return this.formatLocalDate(date);
  }

  getEndOfMonth() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1, 0);
    return this.formatLocalDate(date);
  }

  getStartOfNextMonth() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1, 1);
    return this.formatLocalDate(date);
  }

  getDateOfThisMonth(day) {
    const date = new Date();
    date.setDate(day);
    return this.formatLocalDate(date);
  }

  getDateOfNextMonth(day) {
    const date = new Date();
    date.setMonth(date.getMonth() + 1, day);
    return this.formatLocalDate(date);
  }

  chineseNumberToInt(str) {
    if (/^[0-9]+$/.test(str)) return parseInt(str, 10);

    const numMap = {
      '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
      '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
    };

    if (str.length === 1) return numMap[str] || 0;
    if (str.startsWith('十')) return 10 + (numMap[str[1]] || 0);
    if (str.length === 2 && str.endsWith('十')) return numMap[str[0]] * 10;
    if (str.length === 3 && str[1] === '十') return numMap[str[0]] * 10 + (numMap[str[2]] || 0);
    return 0;
  }

  // ===== 标题清理（简单模式用）=====
  cleanTitle(title) {
    let cleaned = title;

    cleaned = cleaned
      .replace(/下下周[一二三四五六日天]/g, '')
      .replace(/[本这下]周[一二三四五六日天]/g, '')
      .replace(/周[一二三四五六日天](?=\s|$)/g, '')
      .replace(/大后天|后天|明天|今天|明日|今日/g, '')
      .replace(/[本这]个?月底|月底|下个?月初/g, '')
      .replace(/[本这下]个?月[0-9一二三四五六七八九十]+号/g, '')
      .replace(/上午|下午|晚上|中午/g, '')
      .replace(/[0-9]+点半?/g, '')
      .replace(/[之内前后]$/g, '');

    cleaned = cleaned
      .replace(/^紧急[!！]*/, '')
      .replace(/^(必须|重要|赶紧|马上|立刻|尽快)/, '');

    if (this.polishLevel === 'low') return this.finalClean(cleaned, title);

    if (this.polishLevel === 'medium' || this.polishLevel === 'high') {
      const prefixes = ['要去', '得去', '需要去', '记得', '别忘了', '不要忘记', '别忘记'];
      prefixes.sort((a, b) => b.length - a.length);
      for (const prefix of prefixes) {
        if (cleaned.startsWith(prefix)) {
          cleaned = cleaned.slice(prefix.length);
          break;
        }
      }
    }

    if (this.polishLevel === 'high') {
      const highPrefixes = [
        { from: '帮我', to: '' }, { from: '帮忙', to: '' },
        { from: '要', to: '' }, { from: '得', to: '' }, { from: '需要', to: '' }
      ];
      for (const { from, to } of highPrefixes) {
        if (cleaned.startsWith(from)) {
          cleaned = to + cleaned.slice(from.length);
          break;
        }
      }

      const wordReplacements = { '搞定': '完成', '弄好': '完成', '搞': '处理', '弄': '处理' };
      Object.keys(wordReplacements).forEach(key => {
        cleaned = cleaned.replace(new RegExp(key, 'g'), wordReplacements[key]);
      });
      cleaned = cleaned.replace(/一下$/, '');
    }

    return this.finalClean(cleaned, title);
  }

  finalClean(cleaned, originalTitle) {
    cleaned = cleaned
      .replace(/^[，,、。！!？?；;：:]+/, '')
      .replace(/[，,、。！!？?；;：:]+$/, '')
      .replace(/\s+/g, '')
      .trim();

    if (cleaned.length < 2) return originalTitle;
    if (/^[a-z]/.test(cleaned)) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }
}
