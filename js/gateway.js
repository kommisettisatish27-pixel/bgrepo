// Gram UPI Payment Gateway Client for BVC Verify
// Base: https://gateway.anujbots.in

export const GRAM_GATEWAY_CONFIG = {
  apiKey: "FAM_7ad01ca36f50b196a2218e81a3f7f720b8645a285bec7477",
  amount: 500, // Fixed 500 INR per single verification request
  baseUrl: "https://gateway.anujbots.in",
  payeeName: "BVC Engineering College"
};

/**
 * Creates a new payment order and dynamic UPI QR code on Gram Payment Gateway
 */
export async function createGramPaymentOrder({ customerName, customerPhone, roll, note }) {
  const pName = encodeURIComponent(customerName || "BVC Candidate");
  const pPhone = encodeURIComponent(customerPhone || "");
  const pNote = encodeURIComponent(note || `Verification Fee - Roll ${roll || ''}`);
  
  const url = `${GRAM_GATEWAY_CONFIG.baseUrl}/autoqr.php?api_key=${GRAM_GATEWAY_CONFIG.apiKey}&amount=${GRAM_GATEWAY_CONFIG.amount}&customer_name=${pName}&customer_phone=${pPhone}&note=${pNote}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Payment gateway error (${res.status}): Please try again later.`);
  }

  const json = await res.json();
  if (json.status !== "success" || !json.data) {
    throw new Error(json.message || "Failed to initiate UPI payment session.");
  }

  return json.data;
}

/**
 * Checks verification status of a Gram payment order
 */
export async function verifyGramPaymentOrder(orderId) {
  const url = `${GRAM_GATEWAY_CONFIG.baseUrl}/autoverify.php?api_key=${GRAM_GATEWAY_CONFIG.apiKey}&order_id=${encodeURIComponent(orderId)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Payment check error (${res.status}).`);
  }

  const json = await res.json();
  return {
    isPaid: json.status === true && json.data?.status === "PAID",
    status: json.data?.status || (json.status ? "PAID" : "PENDING"),
    utr: json.data?.utr || "",
    amount: json.data?.amount || GRAM_GATEWAY_CONFIG.amount,
    data: json.data,
    raw: json
  };
}

/**
 * Opens checkout popup using GramCheckout or opens payment URL
 */
export function openGramCheckoutPopup(paymentUrl, callbacks = {}) {
  const { onSuccess, onClose, onExpired } = callbacks;

  if (window.GramCheckout && typeof window.GramCheckout.open === "function") {
    try {
      window.GramCheckout.open({
        payment_url: paymentUrl,
        onSuccess: function (p) {
          if (onSuccess) onSuccess(p);
        },
        onExpired: function (p) {
          if (onExpired) onExpired(p);
        },
        onClose: function (p) {
          if (onClose) onClose(p);
        }
      });
      return true;
    } catch (e) {
      console.warn("GramCheckout.open failed, falling back to window.open:", e);
    }
  }

  // Fallback: open in new tab/window
  const w = window.open(paymentUrl, "_blank", "width=480,height=680");
  if (!w) {
    location.href = paymentUrl;
  }
  return false;
}
