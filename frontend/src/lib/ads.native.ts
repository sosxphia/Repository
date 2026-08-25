import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { mobileAds, useInterstitialAd, TestIds } from "react-native-google-mobile-ads";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const productionUnitId = Platform.select({
  android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL,
  ios: process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL,
  default: undefined,
});

const interstitialUnitId = __DEV__ || !productionUnitId ? TestIds.INTERSTITIAL : productionUnitId;

/** Interstitial shown when a focus session finishes. No-ops in Expo Go and for ad-free users. */
export function useCompletionInterstitial(enabled: boolean) {
  const unitId = enabled && !isExpoGo ? interstitialUnitId : null;
  const { isLoaded, load, show } = useInterstitialAd(unitId);

  useEffect(() => {
    if (!unitId) return;
    void mobileAds().initialize();
  }, [unitId]);

  const preload = useCallback(() => {
    if (unitId) load();
  }, [unitId, load]);

  const showIfReady = useCallback(async () => {
    if (!unitId || !isLoaded) return false;
    show();
    return true;
  }, [unitId, isLoaded, show]);

  return { isLoaded, preload, showIfReady };
}
