'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../server');
const presets = require('../src/persona/presets');
const { saveLocalConfiguration, readSnapshot } = require('../src/services/launcherSnapshot');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-portable-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    watchConfig: false, env: { autoDetect: false }, features: { memorySnapshot: false },
    persona: { master: { names: ['private-owner'], wxids: ['wxid_test_owner'] } },
  }));
  const app = await startServer({ root, env: { WHALE_LOG_FILE: '' }, port: 0 });
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return { ...app, root };
}

async function post(app, route, body) {
  const response = await fetch(app.url + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(result.ok, true, result.error);
  return result;
}

const fields = {
  name: '小鱼', age: 31, job: '画家', appearance: '', personality: '沉静',
  background: '', customPrompt: '', ownerName: '老大', aliases: ['小鱼儿'],
  masterRoast: true, proactive: false, opinions: false, emoji: '少', emojiChance: 0.8,
  privateMaxChars: 188, groupMaxChars: 88, historyTurns: 350, groupHistoryTurns: 250,
  maxBubbles: 4, discussionMaxChars: 600,
};

test('单文件完整保存表达设置，导出白名单不包含账号与运行配置', async t => {
  const app = await fixture(t);
  await post(app, '/api/persona', fields);
  const result = await post(app, '/api/persona/preset/save', { name: '安静的小鱼' });
  const file = path.join(app.root, 'data/personas', result.preset.id + '.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.personaName, fields.name);
  for (const key of Object.keys(fields).filter(k => k !== 'name')) assert.deepEqual(saved[key], fields[key], key);
  const exported = (await post(app, '/api/persona/export', {})).persona;
  assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(presets.toPatch(exported), fields);
  assert.doesNotMatch(JSON.stringify(exported), /private-owner|wxid_test_owner|apiKey|permissions|mutedGroups/);
});

test('启用包直接可见，应用设置并编辑本地副本，切换和离线重载保留', async t => {
  const app = await fixture(t);
  const dir = path.join(app.root, 'data/plugins');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'gentle.persona.json');
  const document = { schemaVersion: 1, name: '温和人设包', customPrompt: '补充细节', personaName: '小鱼',
    personality: '沉静', ownerName: '老大', aliases: ['小鱼'], masterRoast: true, proactive: false,
    opinions: false, emojiChance: 0.8, emoji: '正常', maxBubbles: 4, historyTurns: 350,
    master: { wxids: ['must-not-import'] }, apiKey: 'must-not-import', permissions: ['system.full'] };
  fs.writeFileSync(marker, JSON.stringify(document));
  const config = app.runtime.config;
  assert.ok(presets.list(config).some(p => p.id === 'market-gentle'));
  await post(app, '/api/persona/preset', { id: 'market-gentle' });
  assert.equal(config.persona.masterRoast, true);
  assert.equal(config.chat.emojiChance, 0.8);
  assert.equal(config.chat.historyTurns, 350);
  assert.deepEqual(config.persona.master.wxids, ['wxid_test_owner']);
  await post(app, '/api/persona', { personality: '修改后的性格', customPrompt: '', emojiChance: 0, emoji: '关', masterRoast: false, ownerName: '朋友' });
  const edited = path.join(app.root, 'data/personas/market-gentle.json');
  assert.equal(JSON.parse(fs.readFileSync(edited, 'utf8')).personality, '修改后的性格');
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).personality, '沉静', '原始包内容不改');
  const loaded = presets.toPatch(presets.load(config, 'market-gentle'));
  assert.equal(loaded.personality, '修改后的性格');
  assert.equal(loaded.customPrompt, '');
  assert.equal(loaded.masterRoast, false);
  assert.equal(loaded.ownerName, '朋友');
  fs.unlinkSync(marker);
  assert.equal(presets.load(config, 'market-gentle'), null, '停用时即使有本地副本也不再列出');
  assert.equal(config.persona.personality, '修改后的性格', '当前已应用人设保留');
  fs.writeFileSync(marker, JSON.stringify(document));
  await saveLocalConfiguration(app.root, { path: '/api/persona/preset', body: { id: 'market-gentle' } }, {});
  const snapshot = readSnapshot(app.root, {});
  assert.equal(snapshot['/api/persona'].persona.personality, '修改后的性格');
  assert.equal(snapshot['/api/config'].config.persona.ownerName, '朋友');
  assert.equal(snapshot['/api/settings'].userName, '朋友');
  const exported = await saveLocalConfiguration(app.root, { path: '/api/persona/export', body: {} }, {});
  assert.equal(exported.persona.emojiChance, 0);
  assert.equal(exported.persona.masterRoast, false);
  const longPrompt = '鱼'.repeat(25000);
  await post(app, '/api/persona', { customPrompt: longPrompt });
  assert.equal(presets.toPatch(presets.load(config, 'market-gentle')).customPrompt, longPrompt, '本地编辑不因分享包上限静默截断');
  const denied = await fetch(app.url + '/api/persona/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 400);
  assert.equal(config.persona.customPrompt, longPrompt);
});
