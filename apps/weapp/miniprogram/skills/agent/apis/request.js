const { cloudEnv } = require('../config.json');
let initialized = false;
module.exports = async function request(method, path, body, query) {
  try {
    if (!cloudEnv || cloudEnv.startsWith('REPLACE_')) throw new Error('云环境尚未配置，请先完成小程序部署');
    if (!initialized) {
      wx.cloud.init({ env: cloudEnv });
      initialized = true;
    }
    const response = await wx.cloud.callFunction({ name: 'bridge', data: { op: 'skillCall', method, path, body, query } });
    const result = response.result;
    if (!result || !result.ok) throw new Error(result && (result.error || (result.data && result.data.error)) || '请求失败，请重试');
    return { content: [{ type: 'text', text: JSON.stringify(result.data) }], structuredContent: result.data };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message || '服务暂不可用' }] };
  }
};
