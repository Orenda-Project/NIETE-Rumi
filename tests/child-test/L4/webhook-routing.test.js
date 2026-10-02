/**
 * The webhook hands ctst_ buttons and list rows to the child test. Asserted on the router's source,
 * as tests/observe2/command-dispatch.test.js and tests/attendance/attendance-tap-routing.test.js do:
 * booting whatsapp-bot.js here would start workers and Redis. What the branch calls
 * (ChildTest.handleButton / handleList) runs for real in conversation.test.js. Comments are stripped
 * first so a match can never land on prose.
 */
const fs = require('fs');
const path = require('path');

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const BOT = strip(fs.readFileSync(path.join(__dirname, '../../../bot/whatsapp-bot.js'), 'utf8'));
const buttonBranch = BOT.split("interactive?.type === 'button_reply'")[1].split("interactive?.type === 'list_reply'")[0];
const listBranch = BOT.split("interactive?.type === 'list_reply'")[1];

test('button_reply: ctst_ buttons go to the child test right after the resume handler, before any other branch', () => {
  const resume = buttonBranch.indexOf('ConversationResume.handleResumeButton');
  const ours = buttonBranch.indexOf('ChildTest.handleButton(user, from, buttonId)');
  const firstOther = buttonBranch.indexOf("buttonId === 'remark_next'");
  expect(resume).toBeGreaterThan(0);
  expect(ours).toBeGreaterThan(resume);
  expect(firstOther).toBeGreaterThan(ours);
  expect(buttonBranch.slice(ours - 200, ours + 120)).toMatch(/startsWith\('ctst_'\)[\s\S]*ChildTest\.handleButton\(user, from, buttonId\)\)\s*return/);
});

test('list_reply: ctst_ rows go to the child test before the other list prefixes', () => {
  const ours = listBranch.indexOf('ChildTest.handleList(user, from, listId)');
  const firstOther = listBranch.indexOf("listId.startsWith('att_class_')");
  expect(ours).toBeGreaterThan(0);
  expect(firstOther).toBeGreaterThan(ours);
  expect(listBranch.slice(ours - 200, ours + 160)).toMatch(/startsWith\('ctst_'\)[\s\S]*ChildTest\.handleList\(user, from, listId\)\)[\s\S]*ack\(\);\s*return/);
});
