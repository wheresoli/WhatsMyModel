import { WhatsMyModel } from "./whats-my-model.js";

// Register the element once (idempotent — importing twice won't throw).
if (typeof customElements !== "undefined" && !customElements.get("whats-my-model")) {
  customElements.define("whats-my-model", WhatsMyModel);
}

export { WhatsMyModel };
