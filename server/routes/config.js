const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取配置
router.get('/', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    rows.forEach(r => {
        try { config[r.key] = JSON.parse(r.value); }
        catch(e) { config[r.key] = r.value; }
    });
    res.json(config);
});

// 更新配置（批量）
router.put('/', (req, res) => {
    const { apiKey, apiBaseUrl, model, temperature, maxTokens, ui, customInstructions } = req.body;
    const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');

    if (apiKey !== undefined) upsert.run('apiKey', apiKey);
    if (apiBaseUrl !== undefined) upsert.run('apiBaseUrl', apiBaseUrl);
    if (model !== undefined) upsert.run('model', model);
    if (temperature !== undefined) upsert.run('temperature', String(temperature));
    if (maxTokens !== undefined) upsert.run('maxTokens', String(maxTokens));
    if (ui !== undefined) upsert.run('ui', JSON.stringify(ui));
    if (customInstructions !== undefined) upsert.run('customInstructions', customInstructions);

    res.json({ success: true });
});

module.exports = router;
