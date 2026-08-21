const path = require("node:path");
const fs = require("node:fs");

const preparedResources = path.join(__dirname, "resources", "prepared");

module.exports = {
  packagerConfig: {
    name: "HDU-SNAP",
    executableName: "HDU-SNAP",
    appBundleId: "cn.awhg23.hdu-snap",
    appCategoryType: "public.app-category.education",
    asar: true,
    download: {
      checksums: {
        "electron-v43.3.0-darwin-arm64.zip": "ee939d1564d83d61032b3b3cb23af4e46005a4900c91f0695f7ed793f0ce6e83"
      }
    },
    ignore: [
      /^\/resources\/prepared(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/test(?:\/|$)/
    ],
    osxSign: false,
    extendInfo: {
      LSMinimumSystemVersion: "13.0",
      NSHumanReadableCopyright: "Copyright © 2026 HDU-SNAP"
    },
    extraResource: fs.existsSync(preparedResources) ? [preparedResources] : []
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: {
        name: "HDU-SNAP",
        format: "ULFO"
      }
    }
  ]
};
