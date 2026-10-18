import { CumulusController } from "./cumulus-controller.js";

// Runs the cloud in a worker so that building, simulating and drawing it never block the
// main thread. The element (see cumulus-host.js) transfers its canvas as an OffscreenCanvas
// and sends messages; the worker replies with the few things that must happen on the
// main thread (the cursor style and the seed of a clicked cloud).
//
// Messages in:  init { canvas }, build { config, buildId }, pointermove { x, y },
//               pointerleave, pointerclick { x, y }, inview { value }, pagevisible { value },
//               sunset { on, duration }, shadow { settings }
// Messages out: built { buildId, followsMouse }, seedchange { seed }, cursor { cursor }

let canvas = null;
let controller = null;

self.onmessage = ({ data }) => {
  switch (data.type) {
    case "init":
      canvas = data.canvas;
      break;
    case "build":
      controller?.destroy();
      controller = new CumulusController(canvas, {
        ...data.config,
        listenToCanvas: false,
        onSeedChange: (seed) => self.postMessage({ type: "seedchange", seed }),
        onCursorChange: (cursor) => self.postMessage({ type: "cursor", cursor }),
      });
      self.postMessage({
        type: "built",
        buildId: data.buildId,
        followsMouse: controller.followsMouse,
      });
      break;
    case "pointermove":
      controller?.pointerMove(data.x, data.y);
      break;
    case "pointerleave":
      controller?.pointerLeave();
      break;
    case "pointerclick":
      controller?.pointerClick(data.x, data.y);
      break;
    case "inview":
      controller?.setInView(data.value);
      break;
    case "pagevisible":
      controller?.setPageVisible(data.value);
      break;
    case "sunset":
      controller?.setSunset(data.on, data.duration);
      break;
    case "shadow":
      controller?.setShadowDiagonal(data.settings);
      break;
  }
};
