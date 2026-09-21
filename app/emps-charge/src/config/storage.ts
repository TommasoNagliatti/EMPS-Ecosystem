export type StorageKeys = {
  accessToken: string;
  activeSession: string;
  history: string;
  refreshToken: string;
  user: string;
};

export function createStorageKeys(isDemoMode: boolean): StorageKeys {
  const namespace = isDemoMode ? 'emps_demo' : 'emps_real';

  return {
    accessToken: `${namespace}_access_token`,
    activeSession: `${namespace}_active_session`,
    history: `${namespace}_history`,
    refreshToken: `${namespace}_refresh_token`,
    user: `${namespace}_user`,
  };
}
