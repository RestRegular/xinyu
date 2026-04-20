// ===================================================================
// ===== Tool 执行引擎 =====
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

    // 生成通知
    for (const [attr, delta] of Object.entries(changes)) {
        if (attr === 'experience') continue;
        if (delta > 0) addNotification(`${attr.toUpperCase()} +${delta}（${args.reason}）`, 'positive');
        else if (delta < 0) addNotification(`${attr.toUpperCase()} ${delta}（${args.reason}）`, 'negative');
    }

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
            return { success: false, error: '背包已满' };
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
        return { success: false, error: `无法从${current}到达${target}` };
    }

    // 如果是新地点，添加到地图
    if (!currentSave.map.locations[target]) {
        currentSave.map.locations[target] = {
            description: args.description || '一片未知的区域',
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
    addNotification(`状态效果：${args.name}`, args.duration > 0 ? 'negative' : 'positive');
    return { success: true, effect: args.name, duration: args.duration };
}

function handleRemoveStatusEffect(args) {
    currentSave.player.statusEffects = currentSave.player.statusEffects.filter(e => e.name !== args.name);
    updateAttributesPanel();
    addNotification(`状态消除：${args.name}`, 'positive');
    return { success: true, removed: args.name };
}

function handleUpdateGold(args) {
    currentSave.inventory.gold = Math.max(0, currentSave.inventory.gold + args.amount);
    updateInventoryPanel();
    if (args.amount > 0) addNotification(`💰 +${args.amount} 金币（${args.reason}）`, 'positive');
    else addNotification(`💰 ${args.amount} 金币（${args.reason}）`, 'negative');
    return { success: true, new_gold: currentSave.inventory.gold };
}

function handleCheckDeath(args) {
    const hp = currentSave.player.attributes.hp.current;
    if (hp <= 0) {
        currentSave.stats.deaths = (currentSave.stats.deaths || 0) + 1;
        currentSave.eventLog.push({ turn: currentSave.stats.turnCount, type: 'death', text: '玩家死亡' });
        addNotification('💀 你倒下了...', 'negative');
        return { is_dead: true, hp: 0 };
    }
    return { is_dead: false, hp };
}
