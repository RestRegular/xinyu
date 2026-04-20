const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'xinyu.db');

// 确保 data 目录存在
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

const db = new Database(DB_PATH);

// 启用 WAL 模式提升性能
db.pragma('journal_mode = WAL');

// 创建表
db.exec(`
    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saves (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        world_name TEXT DEFAULT '',
        world_genre TEXT DEFAULT '自定义',
        player_name TEXT DEFAULT '',
        player_level INTEGER DEFAULT 1,
        current_location TEXT DEFAULT '',
        turn_count INTEGER DEFAULT 0,
        play_time INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_saved_at TEXT NOT NULL
    );
`);

module.exports = db;
