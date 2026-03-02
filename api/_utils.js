// 共享工具函数 - 供 serverless functions 使用
// 文件名以 _ 开头，Vercel 不会将其作为 API 端点

const crypto = require('crypto');

// ===== Redis 操作 =====

function getConfig() {
  return {
    redisUrl: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    redisToken: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
    authSecret: process.env.AUTH_SECRET
  };
}

async function redis(url, token, args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

// ===== 密码哈希 =====

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, key) => {
      if (err) reject(err);
      resolve(key.toString('hex'));
    });
  });
}

// ===== Token (JWT-like) =====

function createToken(userId, secret) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 天
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  try {
    const [payload, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (sig !== expected) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ===== CORS =====

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ===== 从请求中提取并验证用户 =====

function authenticateRequest(req, secret) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return verifyToken(token, secret);
}

module.exports = {
  getConfig,
  redis,
  hashPassword,
  createToken,
  verifyToken,
  setCors,
  authenticateRequest
};
