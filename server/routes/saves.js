const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取存档列表（索引）
router.get('/', (req, res) => {
    const { filter, sort, search } = req.query;
    let query = 'SELECT id, name, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at FROM saves';
    const params = [];
    const conditions = [];

    if (filter === 'archived') {
        conditions.push('archived = 1');
    } else if (filter && filter !== 'all') {
        conditions.push('world_genre = ? AND archived = 0');
        params.push(filter);
    } else {
        conditions.push('archived = 0');
    }

    if (search) {
        conditions.push('(name LIKE ? OR world_name LIKE ? OR player_name LIKE ?)');
        const s = '%' + search + '%';
        params.push(s, s, s);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }

    // 排序
    const orderBy = {
        lastSaved: 'pinned DESC, last_saved_at DESC',
        created: 'pinned DESC, created_at DESC',
        name: 'pinned DESC, name ASC',
        level: 'pinned DESC, player_level DESC',
    };
    query += ' ORDER BY ' + (orderBy[sort] || orderBy.lastSaved);

    const saves = db.prepare(query).all(...params);
    res.json(saves);
});

// 获取单个存档完整数据
router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT data FROM saves WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: '存档不存在' });
    try {
        res.json(JSON.parse(row.data));
    } catch(e) {
        res.status(500).json({ error: '存档数据解析失败' });
    }
});

// 创建存档
router.post('/', (req, res) => {
    const { id, name, data, worldName, worldGenre, playerName, playerLevel, currentLocation } = req.body;
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO saves (id, name, data, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`)
        .run(id, name, JSON.stringify(data), worldName || '', worldGenre || '', playerName || '', playerLevel || 1, currentLocation || '', now, now);

    res.json({ success: true, id });
});

// 更新存档
router.put('/:id', (req, res) => {
    const { name, data, worldName, worldGenre, playerName, playerLevel, currentLocation, turnCount, playTime, pinned, archived } = req.body;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM saves WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '存档不存在' });

    db.prepare(`UPDATE saves SET name = COALESCE(?, name), data = COALESCE(?, data), world_name = COALESCE(?, world_name), world_genre = COALESCE(?, world_genre), player_name = COALESCE(?, player_name), player_level = COALESCE(?, player_level), current_location = COALESCE(?, current_location), turn_count = COALESCE(?, turn_count), play_time = COALESCE(?, play_time), pinned = COALESCE(?, pinned), archived = COALESCE(?, archived), last_saved_at = ? WHERE id = ?`)
        .run(name, data ? JSON.stringify(data) : null, worldName, worldGenre, playerName, playerLevel, currentLocation, turnCount, playTime, pinned, archived, now, req.params.id);

    res.json({ success: true });
});

// 删除存档
router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM saves WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: '存档不存在' });
    res.json({ success: true });
});

// 导出全部存档
router.get('/export/all', (req, res) => {
    const saves = db.prepare('SELECT id, name, data FROM saves').all();
    const exportData = {
        saves: saves.map(s => ({ ...s, data: JSON.parse(s.data) })),
        exportedAt: new Date().toISOString(),
    };
    res.json(exportData);
});

// 导入存档
router.post('/import', (req, res) => {
    const importData = req.body;
    let count = 0;

    const insert = db.prepare(`INSERT OR REPLACE INTO saves (id, name, data, world_name, world_genre, player_name, player_level, current_location, turn_count, play_time, pinned, archived, created_at, last_saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`);

    const transaction = db.transaction((items) => {
        for (const item of items) {
            const now = new Date().toISOString();
            const d = item.data || item;
            insert.run(
                item.id || 'imp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                item.name || '导入的存档',
                JSON.stringify(d),
                d.world?.name || '', d.world?.genre || '',
                d.player?.name || '', d.player?.level || 1,
                d.map?.currentLocation || '',
                d.stats?.turnCount || 0, d.stats?.playTime || 0,
                now, now
            );
            count++;
        }
    });

    try {
        if (Array.isArray(importData)) {
            transaction(importData);
        } else if (importData.saves) {
            transaction(importData.saves);
        } else {
            transaction([importData]);
        }
        res.json({ success: true, count });
    } catch(e) {
        res.status(500).json({ error: '导入失败: ' + e.message });
    }
});

module.exports = router;
