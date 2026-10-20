const request = require('./request');
module.exports = async function get_today_opportunities({ window = '24h' } = {}) {
  return request('GET', '/api/weapp/v1/opportunities', undefined, { window, limit: 5 });
};
