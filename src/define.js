import { Cumulus } from "./cumulus.js";

if (!customElements.get("cumulus-canvas")) {
  customElements.define("cumulus-canvas", Cumulus);
}
