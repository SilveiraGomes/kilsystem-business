export interface LicenseProvider {
  checkAvailability(): Promise<boolean>;
}
