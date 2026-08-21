"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserController } = require("../src/main/browser-controller.cjs");

function controllerFixture({ windowDestroyed = false, contentsDestroyed = false } = {}) {
  const calls = { detach: 0, close: 0, off: 0 };
  const controller = Object.create(BrowserController.prototype);
  const view = {
    webContents: {
      isDestroyed: () => contentsDestroyed,
      close: () => { calls.close += 1; }
    }
  };
  controller.view = view;
  controller.visible = true;
  controller._resize = () => {};
  controller.window = {
    isDestroyed: () => windowDestroyed,
    contentView: {
      removeChildView: (value) => {
        assert.equal(value, view);
        calls.detach += 1;
      }
    },
    off: () => { calls.off += 1; }
  };
  return { controller, calls };
}

test("destroy is idempotent while the window and child view are alive", () => {
  const { controller, calls } = controllerFixture();
  controller.destroy();
  controller.destroy();
  assert.deepEqual(calls, { detach: 1, close: 1, off: 1 });
  assert.equal(controller.view, null);
  assert.equal(controller.visible, false);
  assert.equal(controller.window, null);
});

test("destroy does not touch native objects after Electron destroyed them", () => {
  const { controller, calls } = controllerFixture({
    windowDestroyed: true,
    contentsDestroyed: true
  });
  assert.doesNotThrow(() => controller.destroy());
  assert.deepEqual(calls, { detach: 0, close: 0, off: 0 });
  assert.equal(controller.view, null);
});

test("browser layout stays centered below the expanded control bar", () => {
  const controller = Object.create(BrowserController.prototype);
  let bounds = null;
  controller.visible = true;
  controller.window = { getContentSize: () => [1200, 800] };
  controller.view = {
    webContents: {
      setUserAgent: () => {},
      setZoomFactor: () => {}
    },
    setBounds: (value) => { bounds = value; },
    setVisible: () => {}
  };
  controller.layout();
  assert.ok(bounds.y >= 136);
  assert.equal(bounds.x, 504);
  assert.equal(bounds.width, 412);
});

test("navigation resolves only after the requested page load settles", async () => {
  const controller = Object.create(BrowserController.prototype);
  const calls = [];
  controller.view = {
    webContents: {
      loadURL: async (url) => { calls.push(url); }
    }
  };
  controller.onHttpBlocked = () => {};
  controller.onState = () => {};
  controller.logger = null;
  const result = await controller.navigate("https://skl.hdu.edu.cn/#/english/list");
  assert.deepEqual(calls, ["https://skl.hdu.edu.cn/#/english/list"]);
  assert.equal(result.url, "https://skl.hdu.edu.cn/#/english/list");
});
