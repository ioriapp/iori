import { performance } from "node:perf_hooks";
// The runner observes waits without changing the native/WebView callers.
const operationObservers = new Set();
const activeOperations = new Map();
let operationSignal;
let cliStatusReader;
let cliQuietObserver;
// Working models change cliStatus within seconds; this leaves a wide margin.
const CLI_STALL_SECONDS = 90;

export function observeCliQuiet(read, listener) {
  cliStatusReader = read;
  cliQuietObserver = listener;
  return () => {
    cliStatusReader = undefined;
    cliQuietObserver = undefined;
  };
}

export function observeOperations(listener, signal) {
  operationObservers.add(listener);
  operationSignal = signal;
  return () => {
    operationObservers.delete(listener);
    operationSignal = undefined;
  };
}
function operationStarted(name) {
  const key = Symbol();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  activeOperations.set(key, name);
  const notify = () => {
    const current = [...activeOperations.values()].at(-1);
    for (const listener of operationObservers) listener(current);
  };
  notify();
  return (failed = false) => {
    activeOperations.delete(key);
    notify();
    const phase = {
      name,
      startedAt,
      seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
      ...(failed ? { failed: true } : {}),
    };
    for (const listener of operationObservers) listener(undefined, phase);
  };
}
export async function withUiAbort(read) {
  const signal = operationSignal;
  if (!signal) return read();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return read();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

// Shared browser operations for native WebViews. Callers bound the entire scenario.
export async function waitFor(
  read,
  predicate = Boolean,
  milliseconds = 45000,
  observation = "画面の待機",
) {
  const done = operationStarted(observation);
  let completed = false;
  try {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      const result = await withUiAbort(read);
      if (predicate(result)) {
        completed = true;
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`${observation}が観測期限を超過しました`);
  } finally {
    done(!completed);
  }
}

// Work duration depends on data size, the machine and the provider. Finish
// on its real result, a reported failure, or an observed CLI stall.
export async function waitForOperation(observation, read, predicate, failed) {
  if (typeof failed !== "function")
    throw new TypeError("失敗の観測を渡してください");
  if (typeof observation !== "string" || !observation.trim())
    throw new TypeError("処理の待ちには観測名が必要です");
  const done = operationStarted(observation);
  let completed = false;
  let fingerprint;
  let quietSince = Date.now();
  let nextStatusRead = 0;
  try {
    for (;;) {
      const value = await withUiAbort(read);
      if (predicate(value)) {
        completed = true;
        return value;
      }
      const failure = await withUiAbort(failed);
      if (failure) throw new Error(`${observation}: ${failure}`);
      if (cliStatusReader && Date.now() >= nextStatusRead) {
        nextStatusRead = Date.now() + 1000;
        let snapshot;
        try {
          snapshot = await withUiAbort(cliStatusReader);
        } catch {
          operationSignal?.throwIfAborted();
        }
        const now = Date.now();
        if (!snapshot || snapshot.failed) {
          fingerprint = undefined;
          quietSince = now;
        } else {
          const terminals = snapshot.terminals
            .map(({ id, cliStatus }) => ({
              id,
              state: cliStatus?.state,
              outcome: cliStatus?.outcome,
              attention: cliStatus?.attention,
              activity: cliStatus?.activity,
              since: cliStatus?.since,
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
          const current = JSON.stringify([terminals, snapshot.progress]);
          const active = terminals.find(
            (terminal) => terminal.state === "active",
          );
          if (current !== fingerprint || !active) quietSince = now;
          fingerprint = current;
          if (active) {
            const seconds = (now - quietSince) / 1000;
            const kind = active.activity?.kind ?? "none";
            cliQuietObserver?.({ observation, seconds, kind });
            if (seconds >= CLI_STALL_SECONDS)
              throw new Error(
                `${observation}: CLIが${CLI_STALL_SECONDS}秒、状態を変えずに応答中のまま止まりました（${active.id}・${kind}）`,
              );
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } finally {
    done(!completed);
  }
}

export function ui(evaluate, gestures) {
  // A Dockview tab can have a box while being clipped by its tab strip.
  // Choose and drag only the portion that the user can actually see.
  const geometry = `const visibleRect=e=>{
    if(!e||getComputedStyle(e).visibility==='hidden')return null;
    const r=e.getBoundingClientRect();
    let left=Math.max(0,r.left),top=Math.max(0,r.top);
    let right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
    let fixed=getComputedStyle(e).position==='fixed';
    for(let p=e.parentElement;p&&!fixed;p=p.parentElement){
      const s=getComputedStyle(p),b=p.getBoundingClientRect();
      if(/hidden|clip|scroll|auto/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}
      if(/hidden|clip|scroll|auto/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}
      fixed=s.position==='fixed';
    }
    return right>left&&bottom>top?{left,top,width:right-left,height:bottom-top}:null;
  };
  const receivesHit=(e,r,x=0.5,y=0.5)=>{
    if(!e||!r)return false;
    const hit=document.elementFromPoint(r.left+r.width*x,r.top+r.height*y);
    return Boolean(hit&&(e.contains(hit)||(hit instanceof HTMLLabelElement&&hit.control===e)));
  };`;
  // Radix keeps exiting surfaces mounted until their animation and focus
  // cleanup finish. They can still cover a visible control or close a new menu.
  // Only a running exit counts: some closed surfaces stay mounted for good.
  const interaction = `${geometry}
    const exiting=[...document.querySelectorAll('[role="menu"][data-state="closed"], [role="dialog"][data-state="closed"], [data-slot="popover-content"][data-state="closed"]')].some(e=>e.getAnimations({subtree:true}).some(a=>a.playState==='running'));
    const hitTarget=(e,r,x=0.5,y=0.5)=>{
      return !exiting&&receivesHit(e,r,x,y);
    };`;
  // Responsive layouts can keep a covered copy of the same control mounted.
  // Actions choose the copy receiving input; reads keep their visible ordering.
  const query = (selector, actionable = false, x = 0.5, y = 0.5) =>
    `(()=>{${geometry}const all=[...document.querySelectorAll(${JSON.stringify(selector)})];return ${actionable ? `all.find(e=>receivesHit(e,visibleRect(e),${x},${y}))??` : ""}all.find(e=>visibleRect(e))??all[0]})()`;
  const visible = (selector) =>
    evaluate(
      `(()=>{${geometry}return Boolean(visibleRect(${query(selector)}));})()`,
    );
  const wait = (selector) =>
    waitFor(() => visible(selector), Boolean, 45000, `表示: ${selector}`);
  const reveal = (selector) =>
    waitFor(
      () =>
        evaluate(
          `(()=>{${geometry}const e=${query(selector)};if(!e)return false;e.scrollIntoView({block:'nearest',inline:'nearest'});return Boolean(visibleRect(e));})()`,
        ),
      Boolean,
      45000,
      `表示: ${selector}`,
    );
  // Activate the rendered control directly once it is visible and enabled.
  // Native WebView pointer coordinates vary with window insets and modal
  // transitions; drag/swipe still use them.
  // `scroll: false` keeps the scroll position the step set up.
  // Optional x/y fractions choose where inside the visible element to hit.
  const click = async (selector, { scroll = true, x = 0.5, y = 0.5 } = {}) => {
    if (scroll) await reveal(selector);
    else await wait(selector);
    await waitFor(
      () =>
        evaluate(
          `(()=>{${interaction}const e=${query(selector, true, x, y)};if(!e||!e.isConnected||e.disabled)return false;if(${scroll})e.scrollIntoView({block:'nearest',inline:'nearest'});if(!hitTarget(e,visibleRect(e),${x},${y}))return false;const pointer=e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));const mouse=e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));if(pointer&&mouse)e.focus();return true;})()`,
        ),
      Boolean,
      45000,
      `操作可能: ${selector}`,
    );
    await evaluate(
      `(()=>{const e=${query(selector, true, x, y)};e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0}));e.click();return true;})()`,
    );
    // Let React commit the action and run its scheduled focus/scroll before
    // the next gesture. A menu opened before an edit's rAF can be closed by it.
    await evaluate(
      "document.hidden ? true : new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
    );
  };
  const doubleClick = async (selector) => {
    await click(selector);
    await click(selector);
    await evaluate(
      `(()=>{const e=${query(selector)};e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0,detail:2}));return true;})()`,
    );
  };
  // Open the element's right-click (long-press) menu at its visible center.
  const contextMenu = async (selector) => {
    await reveal(selector);
    await waitFor(() =>
      evaluate(
        `(()=>{${interaction}const e=${query(selector, true)};const r=visibleRect(e);if(!hitTarget(e,r))return false;e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));return true;})()`,
      ),
    );
  };
  const input = async (selector, value) => {
    await reveal(selector);
    await waitFor(() =>
      evaluate(
        `(()=>{const e=${query(selector)};if(!e||!e.isConnected||e.disabled)return false;e.scrollIntoView({block:'nearest',inline:'nearest'});e.focus();const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
      ),
    );
  };
  const text = (selector) => evaluate(`${query(selector)}?.textContent ?? ''`);
  const value = (selector) => evaluate(`${query(selector)}?.value ?? ''`);
  const scrollPageToTop = () =>
    evaluate("(()=>{window.scrollTo(0,0);return true;})()");
  const attribute = (selector, name, ancestor) =>
    evaluate(
      `${query(selector)}${ancestor ? `?.closest(${JSON.stringify(ancestor)})` : ""}?.getAttribute(${JSON.stringify(name)}) ?? ''`,
    );
  // Check the control before taking coordinates; swipe destinations may lie
  // outside it deliberately.
  const point = async (selector, x = 0.5, y = 0.5) => {
    await reveal(selector);
    return waitFor(() =>
      evaluate(
        `(()=>{${interaction}const e=${query(selector, true)};if(!e)return false;e.scrollIntoView({block:'nearest'});const r=visibleRect(e);if(!hitTarget(e,r))return false;return {x:r.left+r.width*${x},y:r.top+r.height*${y}};})()`,
      ),
    );
  };
  const drag = async (source, target, destination = {}) => {
    if (!gestures) throw new Error("この画面のpointer操作が接続されていません");
    await gestures.drag(
      await point(source),
      await point(target, destination.x ?? 0.5, destination.y ?? 0.5),
    );
    // Pointer drag libraries suppress a trailing click (dnd-kit releases its
    // capture listener after 50 ms). Let the gesture end before the next
    // synthetic click; otherwise that click can be swallowed by the old drag.
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  // HTML drag and drop (Files → Terminal) as DOM DragEvents sharing one
  // DataTransfer: WebDriver's pointer actions do not start the WebView's own
  // drag. Dockview's pointer drag uses `drag` above.
  const htmlDrag = async (source, target) => {
    await reveal(source);
    await reveal(target);
    await evaluate(
      `(()=>{${geometry}const s=${query(source)},t=${query(target)},data=new DataTransfer();const at=e=>{const r=visibleRect(e);return {clientX:r.left+r.width/2,clientY:r.top+r.height/2}};const fire=(e,type)=>e.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data,...at(e)}));fire(s,'dragstart');fire(t,'dragenter');fire(t,'dragover');fire(t,'drop');fire(s,'dragend');return true;})()`,
    );
  };
  const key = async (value) => {
    if (!gestures) throw new Error("この画面のキー操作が接続されていません");
    await gestures.key(value);
  };
  const swipe = async (selector, from, to) => {
    if (!gestures?.swipe)
      throw new Error("この画面のtouch操作が接続されていません");
    const start = await point(selector, from.x, from.y);
    const end = await point(selector, to.x, to.y);
    // A closing Sheet can still intercept touch while the workspace is visible.
    await waitFor(() =>
      evaluate(
        `(()=>{const e=${query(selector)},hit=document.elementFromPoint(${start.x},${start.y});return Boolean(e&&hit&&e.contains(hit));})()`,
      ),
    );
    await gestures.swipe(start, end);
  };
  const tap = async (selector, { dismissKeyboard = false } = {}) => {
    if (!gestures?.tap)
      throw new Error("この画面のtouch操作が接続されていません");
    if (dismissKeyboard) await gestures.dismissKeyboard?.();
    const at = await waitFor(async () => {
      const before = await point(selector);
      await evaluate(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
      );
      const after = await point(selector);
      const enabled = await evaluate(
        `(()=>{const e=${query(selector, true)};return Boolean(e&&!e.disabled);})()`,
      );
      return enabled && before.x === after.x && before.y === after.y
        ? after
        : false;
    });
    await gestures.tap(at);
  };
  // A finger held on the element, as a phone user opens its menu.
  const longPress = async (selector) => {
    if (!gestures?.longPress)
      throw new Error("この画面のtouch操作が接続されていません");
    await gestures.longPress(await point(selector));
    // Sidebar long-press uses dnd-kit's touch sensor too. As after a drag,
    // let its 50 ms trailing-click suppression expire before selecting a menu item.
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  const longPressDrag = async (source, target, held) => {
    if (!gestures?.longPressDrag)
      throw new Error("この画面のtouch操作が接続されていません");
    const from = await point(source);
    const to = target ? await point(target) : from;
    await gestures.longPressDrag(from, to, held);
    await new Promise((resolve) => setTimeout(resolve, 100));
  };
  const evaluateAsync = (expression) =>
    gestures?.evaluateAsync
      ? gestures.evaluateAsync(expression)
      : evaluate(expression);
  const scroll = async (selector, { top, left } = {}) => {
    await wait(selector);
    await evaluate(
      `(()=>{const e=${query(selector)};e.scrollTo({top:${top === "end" ? "e.scrollHeight" : (top ?? "e.scrollTop")},left:${left === "end" ? "e.scrollWidth" : (left ?? "e.scrollLeft")}});return true;})()`,
    );
  };
  // Pointer press with modifiers, for surfaces that act on mousedown (line numbers, Shift+click).
  const press = async (selector, { shiftKey = false } = {}) => {
    await reveal(selector);
    await evaluate(
      `(()=>{const e=${query(selector)};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const o={bubbles:true,cancelable:true,button:0,shiftKey:${shiftKey},clientX:r.x+r.width/2,clientY:r.y+r.height/2};e.dispatchEvent(new MouseEvent('mousedown',o));e.dispatchEvent(new MouseEvent('mouseup',o));e.dispatchEvent(new MouseEvent('click',o));return true;})()`,
    );
  };
  // Submits the form that contains the element, as Enter does.
  const submit = async (selector) => {
    await wait(selector);
    await evaluate(
      `(()=>{${query(selector)}.closest('form').requestSubmit();return true;})()`,
    );
  };
  return {
    point,
    doubleClick,
    evaluate,
    evaluateAsync,
    visible,
    wait,
    reveal,
    click,
    input,
    text,
    value,
    scrollPageToTop,
    contextMenu,
    attribute,
    drag,
    key,
    swipe,
    tap,
    longPress,
    longPressDrag,
    scroll,
    press,
    submit,
    htmlDrag,
  };
}

// Click the visible native surface through its browser's pointer input.
export async function clickWithin(client, selector) {
  await client.screen.wait(selector);
  const { x, y } = await client.screen.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
  );
  if (client.browser.webdriver) {
    await client.browser.call("actions", {
      actions: [
        {
          type: "pointer",
          id: "surface-pointer",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", origin: "viewport", x, y },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  } else {
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }
}

// Scroll through the visible native terminal, without inspecting its buffer.
export async function wheelWithin(
  client,
  selector,
  viewportFraction,
  events = 1,
) {
  const rect = await client.screen.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),height:r.height};})()`,
  );
  const deltaY = Math.round(rect.height * viewportFraction);
  if (client.browser.webdriver) {
    await client.browser.call("actions", {
      actions: [
        {
          type: "wheel",
          id: "terminal-history-wheel",
          actions: Array.from({ length: events }, () => ({
            type: "scroll",
            x: rect.x,
            y: rect.y,
            deltaX: 0,
            deltaY,
            duration: 200,
          })),
        },
      ],
    });
  } else {
    for (let event = 0; event < events; event++) {
      await client.browser.call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: rect.x,
        y: rect.y,
        deltaX: 0,
        deltaY,
      });
    }
  }
  return { deltaY, wheelEvents: events, viewportHeight: rect.height };
}

export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      if (message.error)
        p.reject(
          new Error(
            `CDP command failed: ${p.method}: ${message.error.message}`,
          ),
        );
      else p.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const p of this.pending.values())
        p.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("CDP connection failed")),
        { once: true },
      );
    });
    return new Cdp(socket);
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const detail = String(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "",
      )
        .replace(
          /iori:\/\/pair(?:\?code=|\/)[A-Za-z0-9_-]+/g,
          "[invitation redacted]",
        )
        .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]")
        .slice(0, 1024);
      throw new Error("WebView evaluation failed: " + detail);
    }
    return result.result.value;
  }
  evaluateAsync(expression) {
    return this.evaluate(expression);
  }
  async drag(from, to) {
    await this.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...from,
    });
    await this.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      ...from,
    });
    for (let step = 1; step <= 10; step++) {
      await this.call("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        x: from.x + ((to.x - from.x) * step) / 10,
        y: from.y + ((to.y - from.y) * step) / 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await this.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      clickCount: 1,
      ...to,
    });
  }
  async key(key) {
    const prefix = key.match(/^(?:(?:Control|Shift|Alt)\+)+/u)?.[0] ?? "";
    const parts = prefix ? prefix.slice(0, -1).split("+") : [];
    const main = key.slice(prefix.length);
    const masks = { Alt: 1, Control: 2, Shift: 8 };
    let modifiers = 0;
    for (const modifier of parts) {
      modifiers |= masks[modifier] ?? 0;
      await this.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: modifier,
        modifiers,
      });
    }
    await this.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: main,
      modifiers,
    });
    await this.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: main,
      modifiers,
    });
    for (const modifier of parts.reverse()) {
      modifiers &= ~(masks[modifier] ?? 0);
      await this.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: modifier,
        modifiers,
      });
    }
  }
  async longPressDrag(from, to, held) {
    await Cdp.prototype.swipe.call(this, from, to, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await held?.();
    });
  }
  async tap(at) {
    await this.call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, ...at }],
    });
    await this.call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  async swipe(from, to, held) {
    await this.call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, ...from }],
    });
    await held?.();
    for (
      let step = 1;
      (from.x !== to.x || from.y !== to.y) && step <= 10;
      step++
    ) {
      await this.call("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            id: 0,
            x: from.x + ((to.x - from.x) * step) / 10,
            y: from.y + ((to.y - from.y) * step) / 10,
          },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await this.call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  async longPress(at) {
    await this.call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, ...at }],
    });
    // Held longer than the platform's long-press delay before lifting.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  close() {
    this.socket.close();
  }
}
export class WebDriver {
  constructor(url, sessionId) {
    this.url = url;
    this.sessionId = sessionId;
    // Scenarios choose W3C actions (WebDriver) or CDP input by this mark.
    this.webdriver = true;
  }
  static async create(url, executable, capabilities = {}) {
    const response = await fetch(`${url}/session`, {
      signal: globalThis.AbortSignal.timeout(45000),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            ...capabilities,
            "tauri:options": { application: executable },
          },
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(`WebDriver session failed (${response.status})`);
    return new WebDriver(url, payload.value.sessionId);
  }
  async call(path, body, method = "POST") {
    const response = await fetch(
      `${this.url}/session/${this.sessionId}${path ? "/" + path : ""}`,
      {
        signal: globalThis.AbortSignal.timeout(45000),
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      const errorType = payload?.value?.error;
      const safeErrorType =
        typeof errorType === "string" ? errorType.slice(0, 80) : "unknown";
      const detail = String(payload?.value?.message ?? "")
        .replace(
          /iori:\/\/pair(?:\?code=|\/)[A-Za-z0-9_-]+/g,
          "[invitation redacted]",
        )
        .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]")
        .slice(0, 1024);
      throw new Error(
        `WebDriver command failed (${response.status}; ${safeErrorType})${detail ? ": " + detail : ""}`,
      );
    }
    return payload.value;
  }
  evaluate(expression) {
    return this.call("execute/sync", {
      script: `return ${expression}`,
      args: [],
    });
  }
  evaluateAsync(expression) {
    return this.call("execute/async", {
      script: `const done = arguments[arguments.length - 1]; Promise.resolve(${expression}).then(value => done({ok:true,value}), () => done({ok:false}));`,
      args: [],
    }).then((result) => {
      if (!result.ok) throw new Error("WebView async evaluation failed");
      return result.value;
    });
  }
  async screenshot() {
    return this.call("screenshot", undefined, "GET");
  }
  async drag(from, to) {
    await this.call("actions", {
      actions: [
        {
          type: "pointer",
          id: "workspace-mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            {
              type: "pointerMove",
              duration: 0,
              x: Math.round(from.x),
              y: Math.round(from.y),
            },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: 100 },
            ...Array.from({ length: 10 }, (_, index) => ({
              type: "pointerMove",
              duration: 40,
              x: Math.round(from.x + ((to.x - from.x) * (index + 1)) / 10),
              y: Math.round(from.y + ((to.y - from.y) * (index + 1)) / 10),
            })),
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    await this.call("actions", undefined, "DELETE");
  }
  async key(value) {
    const prefix = value.match(/^(?:(?:Control|Shift|Alt)\+)+/u)?.[0] ?? "";
    const parts = prefix ? prefix.slice(0, -1).split("+") : [];
    const keyCodes = {
      Escape: "\uE00C",
      Enter: "\uE007",
      Control: "\uE009",
      Shift: "\uE008",
      Alt: "\uE00A",
    };
    const main = value.slice(prefix.length);
    const keys = [...parts, main].map((key) => keyCodes[key] ?? key);
    await this.call("actions", {
      actions: [
        {
          type: "key",
          id: "workspace-keyboard",
          actions: [
            ...keys.map((key) => ({ type: "keyDown", value: key })),
            ...keys.toReversed().map((key) => ({ type: "keyUp", value: key })),
          ],
        },
      ],
    });
    await this.call("actions", undefined, "DELETE");
  }
  async close() {
    await this.call("", undefined, "DELETE");
  }
}
