const get_today_opportunities = require('./apis/get_today_opportunities');
const get_opportunity_detail = require('./apis/get_opportunity_detail');
const generate_platform_draft = require('./apis/generate_platform_draft');
const get_draft = require('./apis/get_draft');
const skill = wx.modelContext.createSkill('skills/agent');
skill.registerAPI('get_today_opportunities', get_today_opportunities);
skill.registerAPI('get_opportunity_detail', get_opportunity_detail);
skill.registerAPI('generate_platform_draft', generate_platform_draft);
skill.registerAPI('get_draft', get_draft);
