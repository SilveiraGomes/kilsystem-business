import type { Session } from 'electron';

type PermissionSession = Pick<
  Session,
  'setPermissionCheckHandler' | 'setPermissionRequestHandler'
>;

export const isPermissionAllowed = (): false => false;

export const denyPermissionRequest = (callback: (allowed: boolean) => void): void => {
  callback(false);
};

export const configureSessionPermissions = (session: PermissionSession): void => {
  session.setPermissionCheckHandler(() => isPermissionAllowed());
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    denyPermissionRequest(callback);
  });
};

export const isAllowedNavigation = (targetUrl: string, applicationUrl: string): boolean => {
  try {
    const target = new URL(targetUrl);
    const application = new URL(applicationUrl);

    target.hash = '';
    application.hash = '';

    return target.href === application.href;
  } catch {
    return false;
  }
};
