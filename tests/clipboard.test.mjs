import assert from "node:assert/strict";
import test from "node:test";
import { copyText } from "../lib/clipboard.ts";

const pem = "-----BEGIN CERTIFICATE-----\nexample+line/one==\nexampleLineTwo\n-----END CERTIFICATE-----\n";

function browser(t, clipboard, outcome = true) {
  const original = new Map();
  const install = (key, value) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  };
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const nodes = new Set();
  let copied;
  const state = { focused: null };
  class Element { focus() { state.focused = this; } }
  class Input extends Element {
    value = "";
    style = {};
    selectionStart = 1;
    selectionEnd = 3;
    selectionDirection = "forward";
    select() { this.setSelectionRange(0, this.value.length); }
    setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
    remove() { nodes.delete(this); }
  }
  const initial = new Input();
  initial.focus();
  install("HTMLElement", Element);
  install("HTMLInputElement", Input);
  install("HTMLTextAreaElement", Input);
  install("navigator", { clipboard });
  install("document", {
    get activeElement() { return state.focused; },
    getSelection: () => null,
    createElement: () => new Input(),
    body: { appendChild: (node) => nodes.add(node) },
    execCommand: (command) => {
      assert.equal(command, "copy");
      copied = state.focused.value.slice(state.focused.selectionStart, state.focused.selectionEnd);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });
  return { initial, nodes, copied: () => copied, focused: () => state.focused };
}

test("HTTPS uses Clipboard API without creating temporary DOM", async (t) => {
  let written;
  const env = browser(t, { writeText: async (value) => { written = value; } });
  await copyText(pem);
  assert.equal(written, pem);
  assert.equal(env.copied(), undefined);
  assert.equal(env.nodes.size, 0);
});

test("HTTP copies full multiline PEM without Clipboard API and restores focus/selection", async (t) => {
  const env = browser(t, undefined);
  await copyText(pem);
  assert.equal(env.copied(), pem);
  assert.equal(env.nodes.size, 0);
  assert.equal(env.focused(), env.initial);
  assert.equal(env.initial.selectionStart, 1);
  assert.equal(env.initial.selectionEnd, 3);
});

test("denied modern API falls back to legacy copy", async (t) => {
  const env = browser(t, { writeText: async () => { throw new Error("NotAllowedError"); } });
  await copyText(pem);
  assert.equal(env.copied(), pem);
});

for (const outcome of [false, new Error("NotAllowedError")]) {
  test(`failed legacy copy rejects and removes sensitive temporary text (${String(outcome)})`, async (t) => {
    const env = browser(t, undefined, outcome);
    await assert.rejects(copyText(pem));
    assert.equal(env.nodes.size, 0);
    assert.equal(env.focused(), env.initial);
  });
}
