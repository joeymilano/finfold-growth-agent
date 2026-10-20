const request = require('./request');
module.exports = async function generate_platform_draft({ confirmed, requestId, source, opportunityId, platform, topic } = {}) {
  if (confirmed !== true) return { isError: true, content: [{ type: 'text', text: '本次生成消耗 3 点额度。请先取得用户明确确认，再调用。' }] };
  return request('POST', '/api/weapp/v1/drafts', { requestId, source, opportunityId, platform, topic });
};
