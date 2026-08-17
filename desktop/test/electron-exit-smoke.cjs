"use strict";

const { app, BrowserWindow, WebContentsView } = require("electron");
const { BrowserController } = require("../src/main/browser-controller.cjs");

let failed = false;
process.on("uncaughtException", (error) => {
  failed = true;
  process.stderr.write(error.stack + "\n");
  app.exit(1);
});

app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false });
  const controller = new BrowserController(window);
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  controller.view = view;
  controller.visible = true;
  window.contentView.addChildView(view);
  window.on("close", () => controller.destroy());
  window.on("closed", () => app.exit(failed ? 1 : 0));
  setTimeout(() => window.close(), 100);
});
