type BodyStyles = {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
  paddingRight: string;
};

let lockCount = 0;
let scrollPosition = 0;
let previousBodyStyles: BodyStyles | null = null;
let previousRootOverflow = "";

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  let released = false;
  if (lockCount === 0) {
    const body = document.body;
    const root = document.documentElement;
    scrollPosition = window.scrollY;
    previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };
    previousRootOverflow = root.style.overflow;

    const scrollbarWidth = window.innerWidth - root.clientWidth;
    body.style.position = "fixed";
    body.style.top = `-${scrollPosition}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    root.style.overflow = "hidden";
  }
  lockCount += 1;

  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount > 0 || !previousBodyStyles) return;

    const body = document.body;
    const root = document.documentElement;
    Object.assign(body.style, previousBodyStyles);
    root.style.overflow = previousRootOverflow;
    window.scrollTo(0, scrollPosition);
    previousBodyStyles = null;
  };
}
