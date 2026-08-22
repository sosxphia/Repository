import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { apiFetch } from "./api";

export type PayPalProduct = "streak_freeze" | "tree_revive";
export type PayPalResult = "completed" | "cancelled" | "timeout" | "error";

/**
 * Starts a PayPal purchase: creates the order, opens the approval page,
 * then polls the backend until the payment completes/cancels (max 3 min).
 * Returns a handle to cancel waiting.
 */
export function buyWithPayPal(
  product: PayPalProduct,
  onResult: (result: PayPalResult) => void,
): { cancel: () => void } {
  let active = true;
  (async () => {
    try {
      const order = await apiFetch("/paypal/orders", {
        method: "POST",
        body: JSON.stringify({ product }),
      });
      if (!order?.approve_url) throw new Error("no approval url");
      if (Platform.OS === "web") {
        window.open(order.approve_url, "_blank");
      } else {
        WebBrowser.openBrowserAsync(order.approve_url);
      }
      const started = Date.now();
      const poll = async () => {
        if (!active) return;
        if (Date.now() - started > 180000) {
          active = false;
          onResult("timeout");
          return;
        }
        try {
          const s = await apiFetch(`/paypal/orders/${order.order_id}/status`);
          if (s.status === "completed") {
            active = false;
            if (Platform.OS !== "web") {
              try { WebBrowser.dismissBrowser(); } catch {}
            }
            onResult("completed");
            return;
          }
          if (s.status === "cancelled") {
            active = false;
            onResult("cancelled");
            return;
          }
        } catch {}
        setTimeout(poll, 4000);
      };
      setTimeout(poll, 4000);
    } catch (e) {
      console.log("paypal purchase", e);
      active = false;
      onResult("error");
    }
  })();
  return { cancel: () => { active = false; } };
}
