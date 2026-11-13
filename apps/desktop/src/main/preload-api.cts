export const createDesktopApi = (platform = process.platform) =>
  Object.freeze({
    runtime: Object.freeze({ platform }),
  });
