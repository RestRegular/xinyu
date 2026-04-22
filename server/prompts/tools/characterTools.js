const characterTools = [
    {
        type: 'function',
        function: {
            name: 'update_relationship',
            description: '根据互动内容调整你与玩家的关系值。',
            parameters: {
                type: 'object',
                properties: {
                    delta: { type: 'number', description: '关系变化值（正负均可）' },
                    reason: { type: 'string', description: '原因' },
                },
                required: ['delta', 'reason'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_memory',
            description: '记录本次互动中值得记住的关键信息。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '值得记住的事' },
                    type: { type: 'string', enum: ['favor', 'conflict', 'secret', 'info', 'quest'], description: '记忆类型' },
                },
                required: ['text'],
            },
        },
    },
];

module.exports = { characterTools };
