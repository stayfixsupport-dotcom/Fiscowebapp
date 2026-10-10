let activeTrigger: HTMLElement | null = null;
let triggerClone: HTMLElement | null = null;
let frame = 0;
type PickerWindow = Window & { __fiscoPickerBackdropInstalled?: boolean };

function removeTriggerClone() {
  triggerClone?.remove();
  triggerClone = null;
}

function updateTriggerClone() {
  frame = 0;
  removeTriggerClone();
  if (!activeTrigger?.isConnected || activeTrigger.dataset["state"] !== "open") return;

  const bounds = activeTrigger.getBoundingClientRect();
  triggerClone = activeTrigger.cloneNode(true) as HTMLElement;
  triggerClone.removeAttribute("id");
  triggerClone.removeAttribute("data-picker-trigger");
  triggerClone.setAttribute("aria-hidden", "true");
  triggerClone.setAttribute("tabindex", "-1");
  triggerClone.classList.add("picker-trigger-clone");
  Object.assign(triggerClone.style, {
    position: "fixed",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "102",
    transform: "none",
    transition: "none",
    animation: "none",
  });
  document.body.appendChild(triggerClone);
}

function scheduleUpdate(trigger?: HTMLElement | null) {
  if (trigger) activeTrigger = trigger;
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(updateTriggerClone);
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty(
    "--fisco-visual-viewport-height",
    `${viewport?.height ?? window.innerHeight}px`,
  );
  document.documentElement.style.setProperty(
    "--fisco-visual-viewport-top",
    `${viewport?.offsetTop ?? 0}px`,
  );
}

const pickerWindow = typeof window === "undefined" ? null : (window as PickerWindow);

if (typeof document !== "undefined" && !pickerWindow?.__fiscoPickerBackdropInstalled) {
  if (pickerWindow) pickerWindow.__fiscoPickerBackdropInstalled = true;
  syncVisualViewport();
  document.querySelectorAll(".picker-trigger-clone").forEach((clone) => clone.remove());
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (target instanceof Element) {
        const trigger = target.closest<HTMLElement>("[data-picker-trigger]");
        if (trigger) scheduleUpdate(trigger);
      }
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
      const target = event.target;
      if (target instanceof Element) {
        const trigger = target.closest<HTMLElement>("[data-picker-trigger]");
        if (trigger) scheduleUpdate(trigger);
      }
    },
    true,
  );
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (target instanceof Element) {
        const trigger = target.closest<HTMLElement>("[data-picker-trigger]");
        if (trigger) scheduleUpdate(trigger);
      }
    },
    true,
  );
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target === activeTrigger) || !activeTrigger?.isConnected) {
      scheduleUpdate();
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-state"],
  });
  const onViewportChange = () => {
    syncVisualViewport();
    scheduleUpdate(null);
  };
  window.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("scroll", onViewportChange);
  window.addEventListener("scroll", () => scheduleUpdate(null), true);
}
