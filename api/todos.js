// Vercel Serverless Function - Todo 数据读写

const { getConfig, redis, setCors, authenticateRequest } = require('./_utils');

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { redisUrl, redisToken, authSecret } = getConfig();
  if (!redisUrl || !redisToken || !authSecret) {
    return res.status(500).json({ error: '服务器未配置存储服务' });
  }

  // 验证身份
  const payload = authenticateRequest(req, authSecret);
  if (!payload) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }

  const todosKey = `todos:${payload.sub}`;

  try {
    if (req.method === 'GET') {
      // 获取所有待办
      const data = await redis(redisUrl, redisToken, ['GET', todosKey]);
      const todos = data ? JSON.parse(data) : [];
      return res.status(200).json({ todos });

    } else if (req.method === 'POST') {
      // 保存所有待办（全量替换）
      const { todos } = req.body || {};
      if (!Array.isArray(todos)) {
        return res.status(400).json({ error: '数据格式不正确' });
      }

      await redis(redisUrl, redisToken, ['SET', todosKey, JSON.stringify(todos)]);
      return res.status(200).json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Todos API error:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
};
