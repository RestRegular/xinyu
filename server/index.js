const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化提示词系统
logger.info('Initializing prompt system...');
require('./prompts');
logger.info('Prompt system initialized');

// API 路由
app.use('/api/config', require('./routes/config'));
app.use('/api/saves', require('./routes/saves'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/game', require('./routes/game'));
logger.info('Routes registered: /api/saves, /api/game, /api/config');

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '..', 'public')));

// 静态文件服务（上传的世界卡片 SVG 图片）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 全局错误处理
app.use((err, req, res, next) => {
    logger.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`, { stack: err.stack });
    res.status(500).json({ error: '服务器内部错误' });
});

// 进程级异常监听
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', { message: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', { message: String(reason) });
});

app.listen(PORT, () => {
    logger.info(`Server started on http://localhost:${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
});
