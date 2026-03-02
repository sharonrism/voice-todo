// Vercel Serverless Function - 用户注册与登录

const crypto = require('crypto');
const { getConfig, redis, hashPassword, createToken, setCors } = require('./_utils');

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { redisUrl, redisToken, authSecret } = getConfig();
  if (!redisUrl || !redisToken || !authSecret) {
    return res.status(500).json({ error: '服务器未配置存储服务' });
  }

  const { action, email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: '请填写邮箱和密码' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailKey = `user:${normalizedEmail}`;

  try {
    if (action === 'register') {
      // 检查用户是否已存在
      const existing = await redis(redisUrl, redisToken, ['GET', emailKey]);
      if (existing) {
        return res.status(409).json({ error: '该邮箱已注册，请直接登录' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: '密码至少需要6位' });
      }

      const salt = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(password, salt);
      const userId = crypto.randomUUID();

      const user = { id: userId, email: normalizedEmail, passwordHash, salt };
      await redis(redisUrl, redisToken, ['SET', emailKey, JSON.stringify(user)]);

      const token = createToken(userId, authSecret);
      return res.status(200).json({ token, email: normalizedEmail });

    } else if (action === 'login') {
      const userData = await redis(redisUrl, redisToken, ['GET', emailKey]);
      if (!userData) {
        return res.status(401).json({ error: '邮箱或密码不正确' });
      }

      const user = JSON.parse(userData);
      const passwordHash = await hashPassword(password, user.salt);

      if (passwordHash !== user.passwordHash) {
        return res.status(401).json({ error: '邮箱或密码不正确' });
      }

      const token = createToken(user.id, authSecret);
      return res.status(200).json({ token, email: user.email });

    } else {
      return res.status(400).json({ error: '无效操作' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: '服务器错误，请稍后再试' });
  }
};
