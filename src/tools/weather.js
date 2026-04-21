// tools/weather.js - 天气查询工具
const registry = require('./index');

/**
 * 天气工具
 * 使用 wttr.in API 查询天气
 */
registry.register(
    'weather',
    {
        description: '查询天气预报，支持城市名或机场代码。用这个工具回答所有天气相关问题，不要用 web_search。',
        parameters: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: '城市名或机场代码，如 Beijing, Shanghai, London, NYC'
                }
            },
            required: ['city']
        }
    },
    async (params, context) => {
        const { city } = params;
        if (!city) {
            return '请提供城市名，例如：weather(city="Beijing")';
        }

        const encodedCity = encodeURIComponent(city);
        console.log(`[weather] Querying wttr.in for ${encodedCity}`);

        // 使用 curl 调用 wttr.in
        const { execSync } = require('child_process');
        const cmd = `curl -s --max-time 8 "wttr.in/${encodedCity}?format=%l:+%c+%C,+%t+(feels+like+%f),+wind+%w,+humidity+%h"`;

        try {
            const result = execSync(cmd, {
                encoding: 'utf-8',
                timeout: 10000
            }).trim();

            if (!result ||
                result.includes('Could not resolve') ||
                result.includes('Unknown location')) {
                return `天气查询失败，请确认城市名是否正确（如 Beijing、Shanghai、NYC、London）`;
            }

            return result;
        } catch (error) {
            if (error.killed) {
                return '天气查询超时，请稍后重试';
            }
            return `天气查询出错: ${error.message}`;
        }
    },
    {
        icon: '🌤️',
        label: '查询天气'
    }
);
