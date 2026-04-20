// ===================================================================
// ===== 游戏工具引擎（服务端版） =====
// ===================================================================

/**
 * 执行游戏函数 —— 所有游戏逻辑在服务端运行
 * @param {string} name - 函数名
 * @param {object} args - 函数参数
 * @param {object} saveData - 当前存档数据（会被直接修改）
 * @returns {object} 执行结果
 */
function executeGameFunction(name, args, saveData) {
    switch (name) {
        case 'update_attributes': return handleUpdateAttributes(args, saveData);
        case 'add_item': return handleAddItem(args, saveData);
        case 'remove_item': return handleRemoveItem(args, saveData);
        case 'move_to_location': return handleMoveToLocation(args, saveData);
        case 'add_status_effect': return handleAddStatusEffect(args, saveData);
        case 'remove_status_effect': return handleRemoveStatusEffect(args, saveData);
        case 'update_gold': return handleUpdateGold(args, saveData);
        case 'check_death': return handleCheckDeath(args, saveData);
        case 'create_npc': return handleCreateNpc(args, saveData);
        case 'remove_npc': return handleRemoveNpc(args, saveData);
        case 'equip_item': return handleEquipItem(args, saveData);
        case 'revive_player': return handleRevivePlayer(args, saveData);
        default: return { success: false, error: `未知函数: ${name}` };
    }
}

function handleUpdateAttributes(args, saveData) {
    const results = {};
    const changes = args.changes || {};
    const p = saveData.player;
    const notifications = [];

    for (const [attr, delta] of Object.entries(changes)) {
        if (attr === 'experience') {
            p.experience = (p.experience || 0) + delta;
            results.experience = p.experience;
            // 检查升级
            if (p.experience >= (p.experienceToNext || 100)) {
                p.level++;
                p.experience = 0;
                p.experienceToNext = Math.floor((p.experienceToNext || 100) * 1.5);
                // 升级提升属性
                p.attributes.hp.max += 10;
                p.attributes.hp.current = p.attributes.hp.max;
                p.attributes.mp.max += 5;
                p.attributes.mp.current = p.attributes.mp.max;
                p.attributes.attack.max += 2;
                p.attributes.attack.current += 2;
                p.attributes.defense.max += 1;
                p.attributes.defense.current += 1;
                notifications.push({ text: `🎉 升级！达到 Lv.${p.level}`, type: 'positive' });
                saveData.eventLog.push({ turn: saveData.stats.turnCount, type: 'levelup', text: `升到${p.level}级` });
            }
            continue;
        }
        const attrObj = p.attributes[attr];
        if (attrObj) {
            attrObj.current = Math.max(0, Math.min(attrObj.max, attrObj.current + delta));
            results[attr] = { new_value: attrObj.current, max: attrObj.max, delta };
        }
    }

    // 生成通知（合并多条为一条）
    const posChanges = [];
    const negChanges = [];
    for (const [attr, delta] of Object.entries(changes)) {
        if (attr === 'experience') continue;
        if (delta > 0) posChanges.push(`${attr.toUpperCase()}+${delta}`);
        else if (delta < 0) negChanges.push(`${attr.toUpperCase()}${delta}`);
    }
    if (posChanges.length > 0) notifications.push({ text: posChanges.join(' ') + `（${args.reason}）`, type: 'positive' });
    if (negChanges.length > 0) notifications.push({ text: negChanges.join(' ') + `（${args.reason}）`, type: 'negative' });

    return { success: true, changes: results, reason: args.reason, notifications };
}

function handleAddItem(args, saveData) {
    const newItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: args.name, type: args.type, description: args.description || '',
        quantity: args.quantity || 1, effects: args.effects || {},
        rarity: args.rarity || 'common', usable: args.type === 'consumable',
        equippable: ['weapon', 'armor'].includes(args.type), equipped: false,
    };

    // 检查是否已有相同物品
    const existing = saveData.inventory.items.find(i => i.name === newItem.name && i.stackable !== false);
    if (existing) {
        existing.quantity = (existing.quantity || 1) + newItem.quantity;
    } else {
        if (saveData.inventory.items.length >= saveData.inventory.maxSlots) {
            return { success: false, error: '背包已满，请先丢弃一些物品' };
        }
        saveData.inventory.items.push(newItem);
    }

    saveData.stats.itemsCollected = (saveData.stats.itemsCollected || 0) + 1;

    return {
        success: true, item: newItem.name, total: saveData.inventory.items.length,
        notifications: [{ text: `获得物品：${newItem.name}${newItem.quantity > 1 ? ' x' + newItem.quantity : ''}`, type: 'positive' }]
    };
}

function handleRemoveItem(args, saveData) {
    const idx = saveData.inventory.items.findIndex(i => i.name === args.name);
    if (idx === -1) return { success: false, error: `背包中没有"${args.name}"` };

    const item = saveData.inventory.items[idx];
    const qty = args.quantity || 1;
    if (item.quantity <= qty) {
        saveData.inventory.items.splice(idx, 1);
    } else {
        item.quantity -= qty;
    }

    return {
        success: true, removed: args.name, quantity: qty, remaining: saveData.inventory.items.length,
        notifications: [{ text: `失去物品：${args.name}${qty > 1 ? ' x' + qty : ''}（${args.reason}）`, type: 'negative' }]
    };
}

function handleMoveToLocation(args, saveData) {
    const target = args.location_name;
    const current = saveData.map.currentLocation;
    const notifications = [];

    // 验证是否可以从当前位置到达
    const curLoc = saveData.map.locations[current];
    if (curLoc && curLoc.connections.length > 0 && !curLoc.connections.includes(target)) {
        return { success: false, error: `无法从${current}到达${target}，请选择已知的路径` };
    }

    // 如果是新地点，添加到地图
    if (!saveData.map.locations[target]) {
        if (!args.description) {
            return { success: false, error: `新地点"${target}"必须提供 description` };
        }
        saveData.map.locations[target] = {
            description: args.description,
            connections: args.connections || [current],
            npcs: [], discovered: true, dangerLevel: 0,
        };
        // 确保双向连接
        if (curLoc && !curLoc.connections.includes(target)) {
            curLoc.connections.push(target);
        }
        saveData.stats.locationsDiscovered = (saveData.stats.locationsDiscovered || 0) + 1;
        notifications.push({ text: `🗺️ 发现新地点：${target}`, type: 'info' });
        saveData.eventLog.push({ turn: saveData.stats.turnCount, type: 'discover', text: `发现${target}` });
    } else {
        saveData.map.locations[target].discovered = true;
    }

    saveData.map.currentLocation = target;

    return {
        success: true, current_location: target,
        description: saveData.map.locations[target]?.description,
        notifications
    };
}

function handleAddStatusEffect(args, saveData) {
    const existing = saveData.player.statusEffects.find(e => e.name === args.name);
    if (existing) {
        existing.duration = args.duration;
        existing.effect = args.effect;
    } else {
        saveData.player.statusEffects.push({ name: args.name, duration: args.duration, effect: args.effect });
    }
    const isPositive = ['祝福', '强化', '护盾', '加速', '幸运'].some(k => args.name.includes(k));
    return {
        success: true, effect: args.name, duration: args.duration,
        notifications: [{ text: `状态效果：${args.name}`, type: isPositive ? 'positive' : 'negative' }]
    };
}

function handleRemoveStatusEffect(args, saveData) {
    const before = saveData.player.statusEffects.length;
    saveData.player.statusEffects = saveData.player.statusEffects.filter(e => e.name !== args.name);
    if (saveData.player.statusEffects.length < before) {
        return {
            success: true, removed: args.name,
            notifications: [{ text: `状态消除：${args.name}`, type: 'positive' }]
        };
    }
    return { success: false, error: `没有找到状态效果"${args.name}"` };
}

function handleUpdateGold(args, saveData) {
    const before = saveData.inventory.gold;
    saveData.inventory.gold = Math.max(0, saveData.inventory.gold + args.amount);
    const actual = saveData.inventory.gold - before;
    let notification = null;
    if (actual > 0) notification = { text: `💰 +${actual} 金币（${args.reason}）`, type: 'positive' };
    else if (actual < 0) notification = { text: `💰 ${actual} 金币（${args.reason}）`, type: 'negative' };
    return { success: true, new_gold: saveData.inventory.gold, actual_change: actual, notifications: notification ? [notification] : [] };
}

function handleCheckDeath(args, saveData) {
    const hp = saveData.player.attributes.hp.current;
    if (hp <= 0) {
        saveData.stats.deaths = (saveData.stats.deaths || 0) + 1;
        saveData.eventLog.push({ turn: saveData.stats.turnCount, type: 'death', text: '玩家死亡' });
        return {
            is_dead: true, hp: 0, message: '玩家已死亡，请使用 revive_player 复活玩家继续冒险',
            notifications: [{ text: '💀 你倒下了...世界陷入黑暗', type: 'negative' }]
        };
    }
    return { is_dead: false, hp };
}

function handleCreateNpc(args, saveData) {
    const loc = saveData.map.locations[saveData.map.currentLocation];
    if (!loc) return { success: false, error: '当前位置信息丢失' };

    if (!loc.npcs) loc.npcs = [];
    if (loc.npcs.includes(args.name)) {
        return { success: false, error: `NPC "${args.name}" 已经在此处` };
    }

    loc.npcs.push(args.name);
    return {
        success: true, npc: args.name, location: saveData.map.currentLocation, all_npcs: loc.npcs,
        notifications: [{ text: `👤 遇到新角色：${args.name}`, type: 'info' }]
    };
}

function handleRemoveNpc(args, saveData) {
    const loc = saveData.map.locations[saveData.map.currentLocation];
    if (!loc || !loc.npcs) return { success: false, error: '当前位置没有NPC' };

    const idx = loc.npcs.indexOf(args.name);
    if (idx === -1) return { success: false, error: `NPC "${args.name}" 不在此处` };

    loc.npcs.splice(idx, 1);
    return {
        success: true, removed: args.name, remaining_npcs: loc.npcs,
        notifications: [{ text: `${args.name} 离开了（${args.reason || ''}）`, type: 'info' }]
    };
}

function handleEquipItem(args, saveData) {
    const item = saveData.inventory.items.find(i => i.name === args.name);
    if (!item) return { success: false, error: `背包中没有"${args.name}"` };

    if (args.equip) {
        if (!item.equippable) return { success: false, error: `"${args.name}" 无法装备` };

        // 如果同类型已有装备，先卸下
        if (item.type === 'weapon' || item.type === 'armor') {
            saveData.inventory.items.forEach(i => {
                if (i.type === item.type && i.equipped && i.id !== item.id) {
                    i.equipped = false;
                    if (i.effects) {
                        for (const [attr, val] of Object.entries(i.effects)) {
                            const attrObj = saveData.player.attributes[attr];
                            if (attrObj) {
                                attrObj.current = Math.max(0, attrObj.current - val);
                                attrObj.max = Math.max(1, attrObj.max - val);
                            }
                        }
                    }
                }
            });
        }

        item.equipped = true;
        if (item.effects) {
            for (const [attr, val] of Object.entries(item.effects)) {
                const attrObj = saveData.player.attributes[attr];
                if (attrObj) {
                    attrObj.current += val;
                    attrObj.max += val;
                }
            }
        }
        return {
            success: true, item: args.name, equipped: true,
            notifications: [{ text: `装备了 ${args.name}`, type: 'positive' }]
        };
    } else {
        if (!item.equipped) return { success: false, error: `"${args.name}" 当前未装备` };

        item.equipped = false;
        if (item.effects) {
            for (const [attr, val] of Object.entries(item.effects)) {
                const attrObj = saveData.player.attributes[attr];
                if (attrObj) {
                    attrObj.current = Math.max(0, attrObj.current - val);
                    attrObj.max = Math.max(1, attrObj.max - val);
                }
            }
        }
        return {
            success: true, item: args.name, equipped: false,
            notifications: [{ text: `卸下了 ${args.name}`, type: 'info' }]
        };
    }
}

function handleRevivePlayer(args, saveData) {
    const hp = saveData.player.attributes.hp.current;
    if (hp > 0) return { success: false, error: '玩家还活着，无需复活' };

    const hpPercent = Math.min(100, Math.max(10, args.hp_percent || 50));
    const maxHp = saveData.player.attributes.hp.max;
    saveData.player.attributes.hp.current = Math.max(1, Math.floor(maxHp * hpPercent / 100));

    // 清除所有负面状态
    saveData.player.statusEffects = [];

    // 移动到复活地点
    if (args.revive_location) {
        const target = args.revive_location;
        if (saveData.map.locations[target]) {
            saveData.map.currentLocation = target;
        }
    }

    saveData.eventLog.push({ turn: saveData.stats.turnCount, type: 'revive', text: `在${args.revive_location || saveData.map.currentLocation}复活` });

    return {
        success: true,
        hp: saveData.player.attributes.hp.current,
        max_hp: maxHp,
        location: saveData.map.currentLocation,
        status_cleared: true,
        notifications: [{ text: `✨ 你醒了过来...（恢复 ${hpPercent}% HP）`, type: 'positive' }]
    };
}

module.exports = { executeGameFunction };
