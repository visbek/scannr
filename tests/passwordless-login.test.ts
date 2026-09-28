import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual page handlers with an isolated hook and auth harness.
// No network requests, emails, or credentials are used by these tests.
function harness(auth: Record<string, (...args: any[]) => any>) {
  const values: any[] = [];
  let cursor = 0;
  const navigations: string[] = [];
  const hooks = {
    useState(initial: any) {
      const i = cursor++;
      if (!(i in values)) values[i] = initial;
      return [values[i], (value: any) => { values[i] = value; }];
    },
    useRef(initial: any) {
      const i = cursor++;
      if (!(i in values)) values[i] = { current: initial };
      return values[i];
    },
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const exports: any = {};
  const code = ts.transpileModule(readFileSync('app/login/page.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    window: { location: { origin: 'https://scanrr.sparrwo.com' } },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/navigation') return { useRouter: () => ({ push: (url: string) => navigations.push(url) }) };
      if (name === 'next/link') return { default: 'a' };
      if (name === '@/lib/supabase') return { supabase: { auth } };
      throw Error(name);
    },
  });
  function render() { cursor = 0; return exports.default(); }
  function nodes(node: any): any[] {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const find = (predicate: (node: any) => boolean) => nodes(render()).find(predicate);
  const input = (id: string, value: string) => find(n => n.props?.id === id).props.onChange({ target: { value } });
  const submit = () => find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  return { find, input, submit, navigations };
}

test('email link uses existing account and a fixed scanner destination; success is not authentication', async () => {
  let request: any;
  const h = harness({ signInWithOtp: async (args) => { request = args; return { error: null }; } });
  h.input('signin-email', ' user@example.com ');
  assert.equal(h.find(n => n.props?.id === 'signin-password'), undefined);
  await h.submit();
  assert.equal(request.email, 'user@example.com');
  assert.equal(request.options.shouldCreateUser, false);
  assert.equal(request.options.emailRedirectTo, 'https://scanrr.sparrwo.com/dashboard');
  assert.ok(h.find(n => n.props?.role === 'status'));
  assert.deepEqual(h.navigations, []);
});

test('duplicate submits do not send duplicate emails', async () => {
  let finish: any, count = 0;
  const h = harness({ signInWithOtp: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  const first = h.submit();
  await h.submit();
  assert.equal(count, 1);
  finish({ error: null }); await first;
});

test('rate limits produce an error and leave retry available', async () => {
  const h = harness({ signInWithOtp: async () => ({ error: { status: 429 } }) });
  await h.submit();
  assert.match(h.find(n => n.props?.role === 'alert').props.children, /Too many sign-in/);
  assert.equal(h.find(n => n.props?.role === 'status'), undefined);
  assert.equal(h.find(n => n.props?.type === 'submit').props.disabled, false);
});

test('existing password sign-in remains available', async () => {
  let request: any;
  const h = harness({ signInWithPassword: async args => { request = args; return { error: null }; } });
  h.find(n => n.props?.children === 'Use a password instead').props.onClick();
  h.input('signin-email', 'user@example.com');
  h.input('signin-password', 'test-only-not-a-real-password');
  await h.submit();
  assert.equal(request.email, 'user@example.com');
  assert.deepEqual(h.navigations, ['/dashboard']);
});
