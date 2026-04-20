const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取 API Key（从数据库）
function getApiKey() {
    const row = db.prepare("SELECT value FROM config WHERE key = 'apiKey'").get();
    return row ? row.value : '';
}

function getApiBaseUrl() {
    const row = db.prepare("SELECT value FROM config WHERE key = 'apiBaseUrl'").get();
    return row ? row.value : 'https://api.deepseek.com/v1/chat/completions';
}

function getModel() {
    const row = db.prepare("SELECT value FROM config WHERE key = 'model'").get();
    return row ? row.value : 'deepseek-chat';
}

// 代理 AI 请求（流式）
router.post('/chat', async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
        return res.status(400).json({ error: '未配置 API Key，请在设置中配置' });
    }

    const { messages, tools, temperature, max_tokens } = req.body;
    const apiBaseUrl = getApiBaseUrl();
    const model = getModel();

    try {
        const response = await fetch(apiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                tools: tools || undefined,
                temperature: temperature || 0.9,
                max_tokens: max_tokens || 1024,
                stream: true,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: errText });
        }

        // 转发 SSE 流
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const pump = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    res.end();
                    break;
                }
                res.write(decoder.decode(value, { stream: true }));
            }
        };

        pump().catch(err => {
            console.error('Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: '流式传输失败' });
            }
        });

    } catch(err) {
        res.status(500).json({ error: 'AI 请求失败: ' + err.message });
    }
});

// 非流式 AI 请求（降级用）
router.post('/chat/sync', async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
        return res.status(400).json({ error: '未配置 API Key' });
    }

    const { messages, tools, temperature, max_tokens } = req.body;

    try {
        const response = await fetch(getApiBaseUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: getModel(),
                messages,
                tools: tools || undefined,
                temperature: temperature || 0.9,
                max_tokens: max_tokens || 1024,
                stream: false,
            }),
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch(err) {
        res.status(500).json({ error: 'AI 请求失败: ' + err.message });
    }
});

// 验证 API Key
router.post('/verify', async (req, res) => {
    const apiKey = req.body.apiKey || getApiKey();
    if (!apiKey) {
        return res.json({ valid: false, error: '未提供 API Key' });
    }

    try {
        const response = await fetch(getApiBaseUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model: getModel(), messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
        });

        res.json({ valid: response.ok, status: response.status });
    } catch(err) {
        res.json({ valid: false, error: err.message });
    }
});

module.exports = router;
