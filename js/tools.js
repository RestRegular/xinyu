// ===================================================================
// ===== Tool 执行引擎（完善版） =====
// ===================================================================
function executeGameFunction(name, args) {
    switch (name) {
        case 'update_attributes': return handleUpdateAttributes(args);
        case 'add_item': return handleAddItem(args);
        case 'remove_item': return handleRemoveItem(args);
        case 'move_to_location': return handleMoveToLocation(args);
        case 'add_status_effect': return handleAddStatusEffect(args);
        case 'remove_status_effect': return handleRemoveStatusEffect(args);
        case 'update_gold': return handleUpdateGold(args);
        case 'check_death': return handleCheckDeath(args);
        case 'create_npc': return handleCreateNpc(args);
        case 'remove_npc': return handleRemoveNpc(args);
        case 'equip_item': return handleEquipItem(args);
        case 'revive_player': return handleRevivePlayer(args);
        default: return { success: false, error: `未知函数: ${name}` };
    }
}

function handleUpdateAttributes(args) {
    const results = {};
    const changes = args.changes || {};

    for (const [attr, delta] of Object.entries(changes)) {
        if (attr === 'experience') {
            currentSave.player.experience = (currentSave.player.experience || 0) + delta;
            results.experience = currentSave.player.experience;
            // 检查升级
            if (currentSave.player.experience >= (currentSave.player.experienceToNext || 100)) {
                currentSave.player.level++;
                currentSave.player.experience = 0;
                currentSave.player.experienceToNext = Math.floor((currentSave.player.experienceToNext || 100) * 1.5);
                // 升级提升属性
                currentSave.player.attributes.hp.max += 10;
                currentSave.player.attributes.hp.current = currentSave.player.attributes.hp.max;
                currentSave.player.attributes.mp.max += 5;
                currentSave.player.attributes.mp.current = currentSave.player.attributes.mp.max;
                currentSave.player.attributes.attack.max += 2;
                currentSave.player.attributes.attack.current += 2;
                currentSave.player.attributes.defense.max += 1;
                currentSave.player.attributes.defense.current += 1;
                addNotification(`🎉 升级！达到 Lv.${currentSave.player.level}`, 'positive');
                currentSave.eventLog.push({ turn: currentSave.stats.turnCount, type: 'levelup', text: `升到${currentSave.player.level}级` });
            }
            continue;
        }
        const attrObj = currentSave.player.attributes[attr];
        if (attrObj) {
            attrObj.current = Math.max(0, Math.min(attrObj.max, attrObj.current + delta));
            results[attr] = { new_value: attrObj.current, max: attrObj.max, delta };
        }
    }

    updateAttributesPanel();
    updateSidebar();
    updateGameTopbar();

    // 生成通知（合并多条为一条）
    const posChanges = [];
    const negChanges = [];
    for (const [attr, delta] of Object.entries(changes)) {
        if (attr === 'experience') continue;
        if (delta > 0) posChanges.push(`${attr.toUpperCase()}+${delta}`);
        else if (delta < 0) negChanges.push(`${attr.toUpperCase()}${delta}`);
    }
    if (posChanges.length > 0) addNotification(posChanges.join(' ') + `（${args.reason}）`, 'positive');
    if (negChanges.length > 0) addNotification(negChanges.join(' ') + `（${args.reason}）`, 'negative');

    return { success: true, changes: results, reason: args.reason };
}

function handleAddItem(args) {
    const newItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: args.name, type: args.type, description: args.description || '',
        quantity: args.quantity || 1, effects: args.effects || {},
        rarity: args.rarity || 'common', usable: args.type === 'consumable',
        equippable: ['weapon', 'armor'].includes(args.type), equipped: false,
    };

    // 检查是否已有相同物品
    const existing = currentSave.inventory.items.find(i => i.name === newItem.name && i.stackable !== false);
    if (existing) {
        existing.quantity = (existing.quantity || 1) + newItem.quantity;
    } else {
        if (currentSave.inventory.items.length >= currentSave.inventory.maxSlots) {
            return { success: false, error: '背包已满，请先丢弃一些物品' };
        }
        currentSave.inventory.items.push(newItem);
    }

    currentSave.stats.itemsCollected = (currentSave.stats.itemsCollected || 0) + 1;
    updateInventoryPanel();
    addNotification(`获得物品：${newItem.name}${newItem.quantity > 1 ? ' x' + newItem.quantity : ''}`, 'positive');

    return { success: true, item: newItem.name, total: currentSave.inventory.items.length };
}

function handleRemoveItem(args) {
    const idx = currentSave.inventory.items.findIndex(i => i.name === args.name);
    if (idx === -1) return { success: false, error: `背包中没有"${args.name}"` };

    const item = currentSave.inventory.items[idx];
    const qty = args.quantity || 1;
    if (item.quantity <= qty) {
        currentSave.inventory.items.splice(idx, 1);
    } else {
        item.quantity -= qty;
    }

    updateInventoryPanel();
    addNotification(`失去物品：${args.name}${qty > 1 ? ' x' + qty : ''}（${args.reason}）`, 'negative');

    return { success: true, removed: args.name, quantity: qty, remaining: currentSave.inventory.items.length };
}

function handleMoveToLocation(args) {
    const target = args.location_name;
    const current = currentSave.map.currentLocation;

    // 验证是否可以从当前位置到达
    const curLoc = currentSave.map.locations[current];
    if (curLoc && curLoc.connections.length > 0 && !curLoc.connections.includes(target)) {
        return { success: false, error: `无法从${current}到达${target}，请选择已知的路径` };
    }

    // 如果是新地点，添加到地图
    if (!currentSave.map.locations[target]) {
        if (!args.description) {
            return { success: false, error: `新地点"${target}"必须提供 description` };
        }
        currentSave.map.locations[target] = {
            description: args.description,
            connections: args.connections || [current],
            npcs: [], discovered: true, dangerLevel: 0,
        };
        // 确保双向连接
        if (curLoc && !curLoc.connections.includes(target)) {
            curLoc.connections.push(target);
        }
        currentSave.stats.locationsDiscovered = (currentSave.stats.locationsDiscovered || 0) + 1;
        addNotification(`🗺️ 发现新地点：${target}`, 'info');
        currentSave.eventLog.push({ turn: currentSave.stats.turnCount, type: 'discover', text: `发现${target}` });
    } else {
        currentSave.map.locations[target].discovered = true;
    }

    currentSave.map.currentLocation = target;
    updateSidebar();
    updateMapPanel();
    updateGameTopbar();

    return { success: true, current_location: target, description: currentSave.map.locations[target]?.description };
}

function handleAddStatusEffect(args) {
    const existing = currentSave.player.statusEffects.find(e => e.name === args.name);
    if (existing) {
        existing.duration = args.duration;
        existing.effect = args.effect;
    } else {
        currentSave.player.statusEffects.push({ name: args.name, duration: args.duration, effect: args.effect });
    }
    updateAttributesPanel();
    const isPositive = ['祝福', '强化', '护盾', '加速', '幸运'].some(k => args.name.includes(k));
    addNotification(`状态效果：${args.name}`, isPositive ? 'positive' : 'negative');
    return { success: true, effect: args.name, duration: args.duration };
}

function handleRemoveStatusEffect(args) {
    const before = currentSave.player.statusEffects.length;
    currentSave.player.statusEffects = currentSave.player.statusEffects.filter(e => e.name !== args.name);
    updateAttributesPanel();
    if (currentSave.player.statusEffects.length < before) {
        addNotification(`状态消除：${args.name}`, 'positive');
        return { success: true, removed: args.name };
    }
    return { success: false, error: `没有找到状态效果"${args.name}"` };
}

function handleUpdateGold(args) {
    const before = currentSave.inventory.gold;
    currentSave.inventory.gold = Math.max(0, currentSave.inventory.gold + args.amount);
    const actual = currentSave.inventory.gold - before;
    updateInventoryPanel();
    if (actual > 0) addNotification(`💰 +${actual} 金币（${args.reason}）`, 'positive');
    else if (actual < 0) addNotification(`💰 ${actual} 金币（${args.reason}）`, 'negative');
    return { success: true, new_gold: currentSave.inventory.gold, actual_change: actual };
}

function handleCheckDeath(args) {
    const hp = currentSave.player.attributes.hp.current;
    if (hp <= 0) {
        currentSave.stats.deaths = (currentSave.stats.deaths || 0) + 1;
        currentSave.eventLog.push({ turn: currentSave.stats.turnCount, type: 'death', text: '玩家死亡' });
        addNotification('💀 你倒下了...世界陷入黑暗', 'negative');
        return { is_dead: true, hp: 0, message: '玩家已死亡，请使用 revive_player 复活玩家继续冒险' };
    }
    return { is_dead: false, hp };
}

// ----- 新增：NPC 管理 -----
function handleCreateNpc(args) {
    const loc = currentSave.map.locations[currentSave.map.currentLocation];
    if (!loc) return { success: false, error: '当前位置信息丢失' };

    if (!loc.npcs) loc.npcs = [];
    if (loc.npcs.includes(args.name)) {
        return { success: false, error: `NPC "${args.name}" 已经在此处` };
    }

    loc.npcs.push(args.name);
    updateSidebar();
    addNotification(`👤 遇到新角色：${args.name}`, 'info');

    return { success: true, npc: args.name, location: currentSave.map.currentLocation, all_npcs: loc.npcs };
}

function handleRemoveNpc(args) {
    const loc = currentSave.map.locations[currentSave.map.currentLocation];
    if (!loc || !loc.npcs) return { success: false, error: '当前位置没有NPC' };

    const idx = loc.npcs.indexOf(args.name);
    if (idx === -1) return { success: false, error: `NPC "${args.name}" 不在此处` };

    loc.npcs.splice(idx, 1);
    updateSidebar();
    addNotification(`${args.name} 离开了（${args.reason || ''}）`, 'info');

    return { success: true, removed: args.name, remaining_npcs: loc.npcs };
}

// ----- 新增：装备系统 -----
function handleEquipItem(args) {
    const item = currentSave.inventory.items.find(i => i.name === args.name);
    if (!item) return { success: false, error: `背包中没有"${args.name}"` };

    if (args.equip) {
        // 装备
        if (!item.equippable) return { success: false, error: `"${args.name}" 无法装备` };

        // 如果同类型已有装备，先卸下
        if (item.type === 'weapon' || item.type === 'armor') {
            currentSave.inventory.items.forEach(i => {
                if (i.type === item.type && i.equipped && i.id !== item.id) {
                    i.equipped = false;
                    // 移除装备效果
                    if (i.effects) {
                        for (const [attr, val] of Object.entries(i.effects)) {
                            const attrObj = currentSave.player.attributes[attr];
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
        // 应用装备效果
        if (item.effects) {
            for (const [attr, val] of Object.entries(item.effects)) {
                const attrObj = currentSave.player.attributes[attr];
                if (attrObj) {
                    attrObj.current += val;
                    attrObj.max += val;
                }
            }
        }
        addNotification(`装备了 ${args.name}`, 'positive');
    } else {
        // 卸下
        if (!item.equipped) return { success: false, error: `"${args.name}" 当前未装备` };

        item.equipped = false;
        // 移除装备效果
        if (item.effects) {
            for (const [attr, val] of Object.entries(item.effects)) {
                const attrObj = currentSave.player.attributes[attr];
                if (attrObj) {
                    attrObj.current = Math.max(0, attrObj.current - val);
                    attrObj.max = Math.max(1, attrObj.max - val);
                }
            }
        }
        addNotification(`卸下了 ${args.name}`, 'info');
    }

    updateAttributesPanel();
    updateInventoryPanel();
    updateSidebar();

    return { success: true, item: args.name, equipped: args.equip };
}

// ----- 新增：复活机制 -----
function handleRevivePlayer(args) {
    const hp = currentSave.player.attributes.hp.current;
    if (hp > 0) return { success: false, error: '玩家还活着，无需复活' };

    const hpPercent = Math.min(100, Math.max(10, args.hp_percent || 50));
    const maxHp = currentSave.player.attributes.hp.max;
    currentSave.player.attributes.hp.current = Math.max(1, Math.floor(maxHp * hpPercent / 100));

    // 清除所有负面状态
    currentSave.player.statusEffects = [];

    // 移动到复活地点
    if (args.revive_location) {
        const target = args.revive_location;
        if (currentSave.map.locations[target]) {
            currentSave.map.currentLocation = target;
        }
    }

    updateAttributesPanel();
    updateSidebar();
    updateMapPanel();
    updateGameTopbar();

    addNotification(`✨ 你醒了过来...（恢复 ${hpPercent}% HP）`, 'positive');
    currentSave.eventLog.push({ turn: currentSave.stats.turnCount, type: 'revive', text: `在${args.revive_location || currentSave.map.currentLocation}复活` });

    return {
        success: true,
        hp: currentSave.player.attributes.hp.current,
        max_hp: maxHp,
        location: currentSave.map.currentLocation,
        status_cleared: true,
    };
}
