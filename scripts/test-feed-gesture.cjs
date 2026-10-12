const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compiled = ts.transpileModule(fs.readFileSync('src/components/feedGesture.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { feedSwipeTarget } = exportsObject;
assert.equal(feedSwipeTarget(0, 10, -3), 1, 'short upward swipe advances');
assert.equal(feedSwipeTarget(4, 10, -600), 5, 'long swipe advances exactly one page');
assert.equal(feedSwipeTarget(4, 10, 3), 3, 'short downward swipe returns');
assert.equal(feedSwipeTarget(4, 10, -2), 4, 'touch jitter does not advance');
assert.equal(feedSwipeTarget(4, 10, 0), 4, 'tap does not advance');
assert.equal(feedSwipeTarget(4, 10, 2), 4, 'downward touch jitter does not advance');
assert.equal(feedSwipeTarget(0, 10, 100), 0, 'pull to refresh stays on first page');
assert.equal(feedSwipeTarget(9, 10, -3), 10, 'last card reaches end page');
assert.equal(feedSwipeTarget(10, 10, -100), 10, 'end page stays bounded');
assert.equal(feedSwipeTarget(0, 0, -100), 0, 'empty deck stays bounded');
console.log('Feed swipe regression checks passed.');
