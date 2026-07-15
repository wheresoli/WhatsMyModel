import test from "node:test";
import assert from "node:assert/strict";
import { splitProps } from "./props.js";

test("maps workload scalars to hyphenated attributes (stringified)", () => {
  const { attrs } = splitProps({ task: "code", preference: "fastest", targetContext: 32768, cacheType: "q4_0" });
  assert.deepEqual(attrs, { task: "code", preference: "fastest", "target-context": "32768", "cache-type": "q4_0" });
});

test("routes provider/workload objects to config and pulls out onSelect", () => {
  const hp = {}, cp = {}, wl = {}, onSelect = () => {};
  const { config, onSelect: os } = splitProps({ hardwareProvider: hp, catalogProvider: cp, workload: wl, onSelect });
  assert.equal(config.hardwareProvider, hp);
  assert.equal(config.catalogProvider, cp);
  assert.equal(config.workload, wl);
  assert.equal(os, onSelect);
});

test("passes unknown props (className/style) through as rest", () => {
  const { rest } = splitProps({ className: "x", style: { color: "red" }, task: "chat" });
  assert.deepEqual(rest, { className: "x", style: { color: "red" } });
});

test("drops null/undefined attribute values", () => {
  assert.deepEqual(splitProps({ task: undefined, preference: null }).attrs, {});
});
