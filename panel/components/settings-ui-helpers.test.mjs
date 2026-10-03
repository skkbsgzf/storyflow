import assert from "node:assert/strict";
import test from "node:test";
import { itemsToSwitch } from "./settings-ui-helpers.ts";

const rows = [
  { name: "on", on: true, pinned: false },
  { name: "off", on: false, pinned: false },
  { name: "pinned-on", on: true, pinned: true },
  { name: "pinned-off", on: false, pinned: true },
];
const isOn = (row) => row.on;
const isPinned = (row) => row.pinned;
const names = (items) => items.map((row) => row.name);

test("a group switch targets only the rows not already in the requested state", () => {
  assert.deepEqual(names(itemsToSwitch(rows, true, isOn)), ["off", "pinned-off"]);
  assert.deepEqual(names(itemsToSwitch(rows, false, isOn)), ["on", "pinned-on"]);
  assert.deepEqual(itemsToSwitch(rows.filter(isOn), true, isOn), []);
  assert.deepEqual(itemsToSwitch([], false, isOn), []);
});

test("switching a group off leaves the rows keepOn names, and switching on ignores it", () => {
  assert.deepEqual(names(itemsToSwitch(rows, false, isOn, isPinned)), ["on"]);
  assert.deepEqual(names(itemsToSwitch(rows, true, isOn, isPinned)), ["off", "pinned-off"]);
});

test("returns the original rows in their order", () => {
  const result = itemsToSwitch(rows, true, isOn);
  assert.equal(result[0], rows[1]);
  assert.equal(result[1], rows[3]);
});
