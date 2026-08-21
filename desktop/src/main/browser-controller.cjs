"use strict";

const { WebContentsView, dialog, session } = require("electron");
const { BROWSER_PARTITION, DEFAULT_MOBILE_PROFILE } = require("../shared/constants.cjs");
const { normalizeNavigationUrl } = require("../shared/validation.cjs");

class BrowserController {
  constructor(mainWindow, options = {}) {
    this.window = mainWindow;
    this.preloadPath = options.preloadPath;
    this.logger = options.logger;
    this.onState = options.onState || (() => {});
    this.onHttpBlocked = options.onHttpBlocked || (() => {});
    this.partition = options.partition || BROWSER_PARTITION;
    if (!this.partition.startsWith("persist:hdu-snap-")) {
      throw new TypeError("invalid browser partition");
    }
    this.view = null;
    this.visible = false;
    this.currentUrl = "";
    this._resize = () => this.layout();
    mainWindow.on("resize", this._resize);
  }

  async open(url) {
    if (!this.view) {
      const browserSession = session.fromPartition(this.partition, { cache: true });
      this._secureSession(browserSession);
      this.view = new WebContentsView({
        webPreferences: {
          partition: this.partition,
          preload: this.preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          spellcheck: false,
          backgroundThrottling: false
        }
      });
      // The local renderer is the sole owner of native-view visibility. Keep a
      // newly attached view hidden until the learning page explicitly shows it.
      this.view.setVisible(false);
      this.window.contentView.addChildView(this.view);
      this._wireView();
      this._enableMobileProfile();
      await this._enableMobileNavigator();
    }
    await this.navigate(url, false);
  }

  _secureSession(accountSession) {
    accountSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    accountSession.setPermissionCheckHandler(() => false);
    accountSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders, "Accept-Language": DEFAULT_MOBILE_PROFILE.acceptLanguage };
      callback({ requestHeaders: headers });
    });
    accountSession.on("will-download", async (_event, item) => {
      const result = await dialog.showSaveDialog(this.window, { defaultPath: item.getFilename() });
      if (result.canceled || !result.filePath) item.cancel();
      else item.setSavePath(result.filePath);
    });
  }

  _wireView() {
    const contents = this.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      void this.navigate(url, false).catch((error) => this.logger?.warn("new-window blocked", error.message));
      return { action: "deny" };
    });
    const guardNavigation = (event, url) => {
      let normalized;
      try { normalized = normalizeNavigationUrl(url); } catch {
        event.preventDefault();
        return;
      }
      if (normalized.requiresHttpConfirmation) {
        event.preventDefault();
        this.onHttpBlocked(normalized.url);
      }
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    contents.on("did-navigate", (_event, url) => this._navigationChanged(url));
    contents.on("did-navigate-in-page", (_event, url) => this._navigationChanged(url));
    contents.on("page-title-updated", (_event, title) => this.onState({ title }));
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.onState({ loadError: { code, description, url } });
    });
    contents.on("did-finish-load", async () => {
      try {
        const mobileRuntime = await contents.executeJavaScript(
          "({platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints,width:innerWidth,height:innerHeight})",
          true
        );
        this.onState({ mobileRuntime });
      } catch {}
    });
    contents.on("render-process-gone", (_event, details) => {
      this.onState({
        crashed: true,
        crashDetails: {
          reason: details.reason,
          exitCode: details.exitCode
        }
      });
    });
  }

  _navigationChanged(url) {
    this.currentUrl = url;
    this.onState({
      url,
      loadError: null,
      questionReady: false,
      resultPage: false,
      wrongQuestionReady: false,
      canGoBack: this.view.webContents.navigationHistory.canGoBack(),
      canGoForward: this.view.webContents.navigationHistory.canGoForward()
    });
  }

  _enableMobileProfile(scale = 1) {
    const contents = this.view.webContents;
    contents.setUserAgent(DEFAULT_MOBILE_PROFILE.userAgent);
    // Electron 43 can crash natively when its direct device-emulation API is used on a
    // newly attached WebContentsView. A stable 412-wide view plus mobile
    // Navigator overrides preserve the site's mobile layout safely.
    contents.setZoomFactor(Math.max(0.5, Math.min(1, scale)));
  }

  async _enableMobileNavigator() {
    const contents = this.view.webContents;
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
      await contents.debugger.sendCommand("Network.enable");
      await contents.debugger.sendCommand("Network.setUserAgentOverride", {
        userAgent: DEFAULT_MOBILE_PROFILE.userAgent,
        acceptLanguage: DEFAULT_MOBILE_PROFILE.acceptLanguage,
        platform: DEFAULT_MOBILE_PROFILE.platform
      });
      await contents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: DEFAULT_MOBILE_PROFILE.maxTouchPoints
      });
    } catch (error) {
      this.logger?.warn("mobile navigator override failed", error.message);
    }
  }

  async navigate(value, httpConfirmed = false) {
    if (!this.view) throw new Error("browser view is not ready");
    const target = normalizeNavigationUrl(value);
    if (target.requiresHttpConfirmation && !httpConfirmed) {
      this.onHttpBlocked(target.url);
      return { blocked: "http_confirmation", ...target };
    }
    try {
      await this.view.webContents.loadURL(target.url);
      return target;
    } catch (error) {
      if (error?.code === "ERR_ABORTED") return target;
      this.logger?.warn("page load failed", error.message);
      const loadError = {
        code: error?.code || "ERR_FAILED",
        description: String(error?.message || "page load failed"),
        url: target.url
      };
      this.onState({ loadError });
      return { ...target, loadError };
    }
  }

  show() {
    if (!this.view) return;
    this.visible = true;
    this.layout();
  }

  hide() {
    if (!this.view) return;
    this.visible = false;
    this.view.setVisible(false);
  }

  layout() {
    if (!this.view || !this.visible) return;
    const [width, height] = this.window.getContentSize();
    const left = 220;
    const top = 136;
    const availableWidth = Math.max(320, width - left);
    const availableHeight = Math.max(420, height - top);
    const viewWidth = Math.min(availableWidth, DEFAULT_MOBILE_PROFILE.width);
    const viewHeight = Math.min(availableHeight, DEFAULT_MOBILE_PROFILE.height);
    const x = left + Math.max(0, Math.floor((availableWidth - viewWidth) / 2));
    const y = top + Math.max(0, Math.floor((availableHeight - viewHeight) / 2));
    this._enableMobileProfile(1);
    this.view.setBounds({ x, y, width: viewWidth, height: viewHeight });
    this.view.setVisible(true);
  }

  send(type, payload = {}) {
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send("site:command", { type, payload });
    }
  }

  back() {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  forward() {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  reload() { this.view?.webContents.reload(); }

  setLocked(locked) {
    this.view?.webContents.setIgnoreMenuShortcuts(Boolean(locked));
    this.send("set-locked", { locked: Boolean(locked) });
    this.onState({ locked: Boolean(locked) });
  }

  async clearSession() {
    const browserSession = session.fromPartition(this.partition);
    await browserSession.clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] });
    await browserSession.clearCache();
  }

  async htmlSnapshot() {
    if (!this.view) return "";
    return this.view.webContents.executeJavaScript("document.documentElement.outerHTML", true);
  }

  matchesSender(sender) {
    return Boolean(this.view && sender === this.view.webContents);
  }

  destroyView() {
    const view = this.view;
    this.view = null;
    this.visible = false;
    if (!view) return;
    if (this.window && !this.window.isDestroyed()) {
      this.window.contentView.removeChildView(view);
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.off("resize", this._resize);
    }
    this.destroyView();
    this.window = null;
  }
}

module.exports = { BrowserController };
