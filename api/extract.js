// Vercel Serverless Function - 代理 Gemini API，隐藏 API Key

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    return res.status(500).json({ error: 'Server API key not configured' });
  }

  try {
    const { prompt, text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${prompt}\n\n请处理以下语音识别文本：\n\n"${text}"`
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json'
          }
        })
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Gemini API error:', response.status, error);
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({
        error: error.error?.message || `Gemini API error: ${response.status}`
      });
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      console.error('Gemini returned empty content:', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: 'AI 返回内容为空' });
    }

    return res.status(200).json({ content });
  } catch (error) {
    console.error('Proxy error:', error.message);
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Gemini API 请求超时' });
    }
    return res.status(500).json({ error: error.message });
  }
};
