const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env manually
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
} catch {}

const API_KEY = process.env.OPENAI_API_KEY || '';
const PORT = process.env.PORT || 3423;
const LIMIT = 10;
const sessions = {};

const MIME = {
  html: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
};

function getSession(id) {
  if (!sessions[id]) sessions[id] = { count: 0, created: Date.now() };
  // Reset after 1 hour
  if (Date.now() - sessions[id].created > 3600000) sessions[id] = { count: 0, created: Date.now() };
  return sessions[id];
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Session-ID');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // PROXY ENDPOINT
  if (req.method === 'POST' && req.url === '/api/chat') {
    const sessionId = req.headers['x-session-id'] || 'default';
    const session = getSession(sessionId);

    if (session.count >= LIMIT) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session limit reached. Refresh to start a new session.' }));
      return;
    }

    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const https = require('https');
        const data = JSON.stringify({ model: 'gpt-4o', messages: payload.messages, temperature: 0.8, max_tokens: 600 });

        const options = {
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Length': Buffer.byteLength(data),
          },
        };

        const proxyReq = https.request(options, proxyRes => {
          let result = '';
          proxyRes.on('data', c => result += c);
          proxyRes.on('end', () => {
            session.count++;
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(result);
          });
        });

        proxyReq.on('error', e => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });

        proxyReq.write(data);
        proxyReq.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // STATIC FILES
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);
  try {
    const ext = path.extname(filePath).slice(1);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`EPOCH running on http://localhost:${PORT}`));
