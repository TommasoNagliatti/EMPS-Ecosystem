const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let mockProfile = null;

function load(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const child = new Module(filename, module);
  child.filename = filename;
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const normalRequire = child.require.bind(child);
  child.require = name => {
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === '@/services/emps-api') return { api: {}, frontSession: { get: () => null }, EMPS_SESSION_CHANGED_EVENT: 'session' };
    if (name === '@/components/shell/AppShell') return { AppShell: ({ children }) => React.createElement('main', null, children) };
    if (name === './use-profile-summary') return { useProfileSummary: () => mockProfile };
    if (name === 'next/navigation') return { redirect: target => { throw Object.assign(new Error('Redirect'), { target }); } };
    if (name === '@/components/stations/station-wizard-font') return { stationWizardFont: { className: 'test-font' } };
    if (name === 'next/image') return ({ priority, ...props }) => React.createElement('img', props);
    if (name === 'next/link') return ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);
    if (name === './NavigationLink') return { NavigationLink: ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children) };
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      for (const extension of ['.ts', '.tsx']) if (fs.existsSync(base + extension)) return load(base + extension);
    }
    return normalRequire(name);
  };
  cache.set(filename, child);
  child._compile(compiled, filename);
  return child.exports;
}

const theme = load('components/theme/theme-store.ts');
const model = load('components/account/account-model.ts');

test('theme accepts only known values and has a stable dark server default', () => {
  assert.equal(theme.parseTheme('light'), 'light');
  for (const value of [null, undefined, '', 'dark', 'system', '<script>']) assert.equal(theme.parseTheme(value), 'dark');
  assert.equal(theme.getServerTheme(), 'dark');
});

test('bootstrap restores a saved preference and safely handles unavailable storage', () => {
  for (const [saved, expected] of [['light', 'light'], ['dark', 'dark'], [null, 'dark'], ['invalid', 'dark']]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(theme.themeBootstrap, { document, localStorage: { getItem: () => saved } });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(theme.themeBootstrap, { document, localStorage: { getItem() { throw new Error('Blocked'); } } });
  assert.equal(document.documentElement.dataset.theme, 'dark');
});

test('theme updates locally, synchronizes storage events and unsubscribes listeners', () => {
  const window = new EventTarget(), values = new Map();
  const document = { documentElement: { dataset: { theme: 'dark' } } };
  const localStorage = { setItem: (key, value) => values.set(key, value) };
  window.localStorage = localStorage;
  const originals = { window: global.window, document: global.document, localStorage: global.localStorage };
  Object.assign(global, { window, document, localStorage });
  try {
    let calls = 0;
    const unsubscribe = theme.subscribeTheme(() => calls++);
    theme.setTheme('light');
    assert.equal(theme.getTheme(), 'light');
    assert.equal(values.get(theme.themeStorageKey), 'light');
    assert.equal(calls, 1);
    function storage(key, newValue, storageArea = localStorage) {
      const event = new Event('storage'); Object.assign(event, { key, newValue, storageArea }); window.dispatchEvent(event);
    }
    storage('other', 'dark'); storage(theme.themeStorageKey, 'dark', {});
    assert.equal(calls, 1);
    storage(theme.themeStorageKey, 'dark');
    assert.equal(theme.getTheme(), 'dark');
    storage(null, null);
    assert.equal(calls, 3);
    localStorage.setItem = () => { throw new Error('Blocked'); };
    theme.setTheme('light');
    assert.equal(theme.getTheme(), 'light');
    unsubscribe(); theme.setTheme('dark');
    assert.equal(calls, 4);
  } finally { Object.assign(global, originals); }
});

test('profile projection excludes tokens and never modifies the original session', () => {
  const session = { usuarioId: 'fixture', nome: 'Example Person', email: 'example@example.invalid', role: 'proprietario', token: 'secret-fixture', modo: 'api' };
  assert.deepEqual(Object.keys(model.profileSummary(session)).sort(), ['email', 'nome', 'role', 'usuarioId']);
  assert.equal(session.token, 'secret-fixture');
  assert.equal(model.profileSummary(null), null);
  assert.equal(model.profileInitials('  Example Person  '), 'EP');
  assert.equal(model.profileInitials(''), 'EM');
});

test('account sections use an allowlist for URL parameters', () => {
  for (const tab of model.accountTabs) assert.equal(model.accountTab(tab), tab);
  for (const value of [null, 'logout', '<script>', ['security']]) assert.equal(model.accountTab(value), 'profile');
});

test('personal forms are explicitly unavailable and expose no submit action', () => {
  const { AccountSettings } = load('components/account/AccountSettings.tsx');
  for (const tab of ['profile', 'account', 'security']) {
    const markup = renderToStaticMarkup(React.createElement(AccountSettings, { tab }));
    assert.ok(markup.includes('Em breve'));
    assert.ok(markup.includes('disabled=""'));
    assert.ok(!markup.includes('type="submit"'));
    assert.ok(!markup.includes('secret-fixture'));
  }
  const security = renderToStaticMarkup(React.createElement(AccountSettings, { tab: 'security' }));
  assert.equal((security.match(/type="password"/g) ?? []).length, 3);
  assert.equal((security.match(/maxLength="72"/g) ?? []).length, 3);
});

test('appearance is functional inside settings and the profile menu links to the same area', () => {
  const { AccountSettings } = load('components/account/AccountSettings.tsx');
  const { ProfileMenu } = load('components/account/ProfileMenu.tsx');
  const markup = renderToStaticMarkup(React.createElement(AccountSettings, { tab: 'appearance' }));
  assert.ok(markup.includes('Tema do site e do mapa'));
  assert.ok(markup.includes('aria-pressed="true"'));
  assert.ok(!markup.includes('Em breve'));
  assert.ok(renderToStaticMarkup(React.createElement(ProfileMenu)).includes('aria-haspopup="dialog"'));
  const source = fs.readFileSync(path.join(root, 'components/account/ProfileMenu.tsx'), 'utf8');
  assert.ok(source.includes("href: '/settings'"));
  assert.ok(source.includes("label: 'Configurações'"));
  assert.ok(!source.includes('Configurações do site'));
  assert.ok(!source.includes('ThemeSelector'));
  for (const tab of ['profile', 'account', 'security']) assert.ok(source.includes(`/settings?tab=${tab}`));
  assert.ok(source.includes('api.logout()'));
});

test('sidebar keeps integration links separate and selects the matching EMPS page', () => {
  const { SidebarNavigation } = load('components/shell/SidebarNavigation.tsx');
  for (const [pathname, selected] of [
    ['/stations', '/stations'], ['/stations/new', '/stations'],
    ['/sessions', '/sessions'], ['/stations-archive', null],
    ['/', null], ['/stations/1/dashboard', '/stations'], ['/stations/1', '/stations'], ['/account', null], ['/settings', null],
  ]) {
    const markup = renderToStaticMarkup(React.createElement(SidebarNavigation, {
      pathname, expanded: true, mobileOpen: false, onToggle() {}, onClose() {},
    }));
    const current = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"/g)].map(match => match[1]);
    assert.deepEqual(current, selected ? [selected] : []);
    for (const route of ['stations', 'chargers', 'sessions', 'payments', 'clients', 'alerts']) {
      assert.ok(markup.includes(`href="/${route}"`));
    }
    assert.ok(!markup.includes('href="/settings"'));
    assert.ok(!markup.includes('href="/dashboard"'));
    assert.ok(!markup.includes('Configuracoes EMPS'));
    assert.ok(markup.includes('href="https://semsplus.goodwe.com/#/alarm_center" target="_blank" rel="noreferrer"'));
    assert.ok(markup.includes('href="https://semsplus.goodwe.com/#/data_comparison" target="_blank" rel="noreferrer"'));
    assert.ok(markup.includes('aria-label="Recolher menu"'));
  }
});

test('settings parameters default to appearance and reject unknown values', () => {
  for (const tab of model.settingsTabs) assert.equal(model.settingsTab(tab), tab);
  for (const value of [undefined, null, '', 'logout', '<script>', ['security']]) assert.equal(model.settingsTab(value), 'appearance');
  assert.equal(new Set(model.settingsTabs).size, 5);
});

test('settings navigation uses canonical links and highlights a single section', () => {
  const { AccountSettings } = load('components/account/AccountSettings.tsx');
  for (const tab of model.accountTabs) {
    const markup = renderToStaticMarkup(React.createElement(AccountSettings, { tab }));
    assert.ok(markup.includes('<h1>Configurações</h1>'));
    assert.ok(!markup.includes('href="/account'));
    const selected = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"/g)].map(match => match[1]);
    assert.deepEqual(selected, [`/settings?tab=${tab}`]);
  }
});

test('administration remains restricted and falls back to appearance without an admin profile', () => {
  const { AccountSettings } = load('components/account/AccountSettings.tsx');
  try {
    for (const role of [null, 'proprietario', 'operador', 'goodwe', 'admin']) {
      mockProfile = role ? { nome: 'Example', email: 'example@example.invalid', usuarioId: 'fixture', role } : null;
      const markup = renderToStaticMarkup(React.createElement(AccountSettings, { tab: 'administration' }));
      assert.equal(markup.includes('href="/settings?tab=administration"'), role === 'admin');
      assert.equal(markup.includes('<h2>Administradores</h2>'), role === 'admin');
      assert.equal(markup.includes('Tema do site e do mapa'), role !== 'admin');
    }
  } finally { mockProfile = null; }
});

test('legacy account URLs redirect to the matching settings section', async () => {
  const { default: AccountPage } = load('app/account/page.tsx');
  const { default: SettingsPage } = load('app/settings/page.tsx');
  for (const tab of [undefined, ...model.accountTabs, 'invalid', ['security']]) {
    await assert.rejects(AccountPage({ searchParams: Promise.resolve({ tab }) }), error => error.target === `/settings?tab=${model.accountTab(tab)}`);
  }
  const page = await SettingsPage({ searchParams: Promise.resolve({}) });
  assert.equal(page.props.tab, 'appearance');
});
