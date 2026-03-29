// 语音识别模块 - 封装 Web Speech API

class SpeechRecognizer {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.initRecognition();
  }

  initRecognition() {
    // 检查浏览器支持
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      throw new Error('浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器');
    }

    this.recognition = new SpeechRecognition();

    // 配置语音识别
    this.recognition.lang = 'zh-CN';              // 中文识别
    this.recognition.continuous = true;           // 持续识别，不会自动停止 ✨
    this.recognition.interimResults = true;       // 显示实时结果
    this.recognition.maxAlternatives = 1;         // 只要最佳结果

    // 用于累积识别结果
    this.accumulatedTranscript = ''; // 跨自动重连累积的文本
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.manualStop = false; // 是否手动停止（区分自动断开和用户点击停止）

    // 绑定事件
    this.recognition.onstart = () => {
      this.isListening = true;
      console.log('语音识别已启动');
      this.onStatusChange('listening');
    };

    this.recognition.onresult = (event) => {
      // 累积识别结果（持续模式）
      this.finalTranscript = '';
      this.interimTranscript = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const confidence = result[0].confidence;

        if (result.isFinal) {
          // 过滤置信度极低的片段（低于 0.3 的通常是乱码）
          if (confidence > 0 && confidence < 0.3) {
            console.log(`低置信度片段被过滤 (${(confidence * 100).toFixed(0)}%):`, transcript);
            continue;
          }
          this.finalTranscript += transcript;
          console.log(`识别片段 (置信度 ${confidence > 0 ? (confidence * 100).toFixed(0) + '%' : '未知'}):`, transcript);
        } else {
          this.interimTranscript += transcript;
        }
      }

      // 组合累积 + 当前会话的最终 + 临时结果
      const fullTranscript = this.accumulatedTranscript + this.finalTranscript + this.interimTranscript;

      // 基础清理（修正常见识别错误）
      const cleanedTranscript = this.cleanTranscript(fullTranscript);

      // 实时显示
      this.onInterimResult(cleanedTranscript);
    };

    this.recognition.onerror = (event) => {
      console.error('语音识别错误:', event.error);
      this.isListening = false;

      let errorMessage = '语音识别出错';
      switch (event.error) {
        case 'no-speech':
          errorMessage = '没有检测到语音，请重试';
          break;
        case 'audio-capture':
          errorMessage = '无法访问麦克风，请检查权限';
          break;
        case 'not-allowed':
          errorMessage = '麦克风权限被拒绝，请在浏览器设置中允许';
          break;
        case 'network':
          errorMessage = '网络错误，请检查网络连接';
          break;
        case 'aborted':
          errorMessage = '识别已取消';
          break;
        default:
          errorMessage = `识别错误: ${event.error}`;
      }

      this.onError(errorMessage);
    };

    this.recognition.onend = () => {
      console.log('语音识别 onend, manualStop:', this.manualStop);

      // 如果不是手动停止，说明是浏览器自动断开（说话停顿），自动重连
      if (!this.manualStop && this.isListening) {
        console.log('自动重连语音识别...');
        // 保存当前会话的 finalTranscript，防止重连后丢失
        this.accumulatedTranscript += this.finalTranscript;
        this.finalTranscript = '';
        this.interimTranscript = '';
        try {
          this.recognition.start();
          return; // 不要重置状态，继续累积
        } catch (e) {
          console.error('自动重连失败:', e);
        }
      }

      this.isListening = false;

      // 处理最终结果：合并所有累积的文本
      // 优先用 final，如果 final 为空（用户在 interim 状态就停止了），用 interim 兜底
      const allFinal = this.accumulatedTranscript + this.finalTranscript;
      const allText = allFinal || (this.accumulatedTranscript + this.interimTranscript);
      const finalText = this.cleanTranscript(allText);

      if (finalText.trim()) {
        console.log('最终识别结果:', finalText);
        this.onFinalResult(finalText);
      }

      // 重置
      this.accumulatedTranscript = '';
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.manualStop = false;

      this.onStatusChange('idle');
    };
  }

  // 开始识别
  start() {
    if (!this.isListening) {
      try {
        // 重置累积的文本
        this.accumulatedTranscript = '';
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.manualStop = false;
        this.recognition.start();
      } catch (error) {
        console.error('启动语音识别失败:', error);
        if (error.name === 'InvalidStateError') {
          // 识别器可能还在运行，先停止再启动
          this.recognition.stop();
          setTimeout(() => {
            this.accumulatedTranscript = '';
            this.finalTranscript = '';
            this.interimTranscript = '';
            this.recognition.start();
          }, 100);
        }
      }
    }
  }

  // 停止识别（用户手动点击停止）
  stop() {
    if (this.isListening) {
      console.log('手动停止识别');
      this.manualStop = true;
      this.recognition.stop();
    }
  }

  // 取消识别
  abort() {
    if (this.isListening) {
      this.recognition.abort();
    }
  }

  // 清理识别文本（修正常见错误）
  cleanTranscript(text) {
    let cleaned = text;

    // 修正常见的同音字错误
    const corrections = [
      // 数字/日期相关
      { wrong: /周5/g, correct: '周五' },
      { wrong: /周6/g, correct: '周六' },
      { wrong: /周7/g, correct: '周日' },
      { wrong: /礼拜/g, correct: '周' },
      { wrong: /星期/g, correct: '周' },
      // 常见同音字错误
      { wrong: /在说/g, correct: '再说' },
      { wrong: /在见/g, correct: '再见' },
      { wrong: /在来/g, correct: '再来' },
      { wrong: /在做/g, correct: '再做' },
      { wrong: /在去/g, correct: '再去' },
      // 待办场景常见错误
      { wrong: /健生/g, correct: '健身' },
      { wrong: /建身/g, correct: '健身' },
      { wrong: /定好/g, correct: '订好' },
      { wrong: /做做/g, correct: '做' },
      { wrong: /想想/g, correct: '想' },
      { wrong: /记的/g, correct: '记得' },
      { wrong: /在线/g, correct: '在线' },
      { wrong: /发信/g, correct: '发信' }
    ];

    corrections.forEach(({wrong, correct}) => {
      cleaned = cleaned.replace(wrong, correct);
    });

    // 移除句子开头和结尾的口头禅
    cleaned = cleaned
      .replace(/^(嗯+|啊+|呃+|额+|哦+|噢+)[\s，,]*/, '')
      .replace(/^(这个|那个|就是说?|然后)[\s，,]*/, '')
      .replace(/(嗯|啊|呃|额|哦|噢)+$/g, '')
      .trim();

    // 移除多余的空格
    cleaned = cleaned.replace(/\s+/g, '');

    return cleaned;
  }

  // 回调方法（外部设置）
  onFinalResult(text) {
    // 最终识别结果回调
    // 外部应该重写此方法
  }

  onInterimResult(text) {
    // 实时识别结果回调
    // 外部应该重写此方法
  }

  onError(errorMessage) {
    // 错误回调
    // 外部应该重写此方法
  }

  onStatusChange(status) {
    // 状态变化回调 (idle/listening)
    // 外部应该重写此方法
  }
}
