const request = require('./request');
module.exports = async function get_draft({ id } = {}) {
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) return { isError: true, content: [{ type: 'text', text: '请提供有效草稿 ID' }] };
  return request('GET', `/api/weapp/v1/drafts/${id}`);
};
