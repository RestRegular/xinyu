const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API 路由
app.use('/api/config', require('./routes/config'));
app.use('/api/saves', require('./routes/saves'));
app.use('/api/ai', require('./routes/ai'));

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '..')));

// 所有其他路由返回 index.html（SPA 支持）
app.get('/{*splat}', (req, res) => {
    const splat = req.params.splat || '';
    if (!splat.includes('.') || splat.endsWith('.html')) {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`心隅服务器已启动: http://localhost:${PORT}`);
});
