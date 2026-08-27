/** Platform-resolved at build time: ads.native.ts (device) / ads.web.ts (preview). */
export declare function useCompletionInterstitial(enabled: boolean): {
  isLoaded: boolean;
  preload: () => void;
  showIfReady: () => Promise<boolean>;
};
