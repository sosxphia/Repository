/** Web preview has no AdMob — everything is a no-op. */
export function useCompletionInterstitial(_enabled: boolean) {
  return {
    isLoaded: false,
    preload: () => {},
    showIfReady: async () => false,
  };
}
