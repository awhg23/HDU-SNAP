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
