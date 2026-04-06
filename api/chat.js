const https = require('https');

const LIMIT = 10;
const sessions = {};

function getSession(id) {
  if (!sessions[id]) sessions[id] = { count: 0, created: Date.now() };
  if (Date.now() - sessions[id].created > 3600000) sessions[id] = { count: 0, created: Date.now() };
  return sessions[id];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Session-ID');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const sessionId = req.headers['x-session-id'] || 'default';
  const session = getSession(sessionId);

  if (session.count >= LIMIT) {
    res.status(429).json({ error: 'Session limit reached. Refresh to start a new session.' });
    return;
  }

  const { messages } = req.body;
  if (!messages) { res.status(400).json({ error: 'No messages provided' }); return; }

  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages,
    temperature: 0.8,
    max_tokens: 600
  });

  const options = {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve) => {
    const proxyReq = https.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        session.count++;
        res.status(proxyRes.statusCode).json(JSON.parse(data));
        resolve();
      });
    });

    proxyReq.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });

    proxyReq.write(payload);
    proxyReq.end();
  });
};
