/**
 * isPortalRequest — is this whole message a request for the portal, and nothing else? (pure; the table the keyword
 * doors in text-message.handler.js and student-ingress.js both read)
 */
const { isPortalRequest, keywordRoutingOn } = require('../../shared/services/portal-request');

describe('isPortalRequest', () => {
  test.each([
    'portal', 'Portal', 'PORTAL', 'portal?', 'portal!', ' portal. ', 'portals', 'portl', 'portel', 'protal',
    '/portal', '/Portal', '/portal please', '/ portal', 'portal/', '\\portal',
    'open portal', 'open my portal', 'my portal', 'the portal', 'portal link', 'portal login', 'send me the portal link',
    'portal please', 'pls portal', 'where is my portal', 'NIETE portal', 'teacher app portal',
    'mera portal', 'portal kholo', 'portal khol do', 'portal link bhejo', 'mujhe portal ka link dein', 'portal chahiye',
    'پورٹل', 'پورٹال', 'پورٹل کھولیں', 'میرا پورٹل', 'پورٹل کا لنک دیں', 'مجھے پورٹل کا لنک بھیجیں', 'پورٹل؟',
    '⁦/portal⁩',
  ])('%j → true', (text) => {
    expect(isPortalRequest(text)).toBe(true);
  });

  test.each([
    '', '   ', null, undefined, 'hello', 'quiz', 'port', 'portable', 'menu',
    // a message that carries content belongs to the classifier / the chat
    'portal pe lesson nahi khul raha', 'what is portal', 'what is the portal', 'portal password', 'portal password bhool gaya',
    'my portal is not opening', 'how do i open the portal', 'portal kaise kholun', 'پورٹل نہیں کھل رہا', 'پورٹل کیا ہے',
    'quiz portal',          // two different requests: not this door's to guess
    'portal portal portal portal portal portal portal', // past the length of a request
  ])('%j → false', (text) => {
    expect(isPortalRequest(text)).toBe(false);
  });
});

describe('keywordRoutingOn (PORTAL_KEYWORD_ROUTING, default ON)', () => {
  const saved = process.env.PORTAL_KEYWORD_ROUTING;
  afterAll(() => { if (saved === undefined) delete process.env.PORTAL_KEYWORD_ROUTING; else process.env.PORTAL_KEYWORD_ROUTING = saved; });
  test.each([[undefined, true], ['', true], ['true', true], ['1', true], ['false', false], ['0', false], ['OFF', false], [' no ', false]])(
    '%j → %s', (v, want) => {
      if (v === undefined) delete process.env.PORTAL_KEYWORD_ROUTING; else process.env.PORTAL_KEYWORD_ROUTING = v;
      expect(keywordRoutingOn()).toBe(want);
    },
  );
});
