(() => {
  if (globalThis.__PAGE_SCREENSHOT_TOOL__) return;

  const capture = {
    session: null,

    async nextPaint(delay = 0) {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    },

    readMetrics() {
      const root = document.documentElement;
      const body = document.body;
      return {
        totalWidth: Math.max(root.scrollWidth, root.offsetWidth, root.clientWidth, body?.scrollWidth || 0, body?.offsetWidth || 0),
        totalHeight: Math.max(root.scrollHeight, root.offsetHeight, root.clientHeight, body?.scrollHeight || 0, body?.offsetHeight || 0),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio || 1
      };
    },

    findPersistentElements() {
      const elements = [];
      for (const element of document.querySelectorAll("*")) {
        const style = getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") continue;

        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || style.display === "none") continue;

        elements.push({
          element,
          position: style.position,
          originalVisibility: element.style.getPropertyValue("visibility"),
          originalPriority: element.style.getPropertyPriority("visibility")
        });
      }
      return elements;
    },

    showPersistentElements() {
      for (const item of this.session?.persistentElements || []) {
        if (item.originalVisibility) {
          item.element.style.setProperty("visibility", item.originalVisibility, item.originalPriority);
        } else {
          item.element.style.removeProperty("visibility");
        }
      }
    },

    armWatchdog() {
      if (!this.session) return;
      clearTimeout(this.session.watchdog);
      // This is an inactivity timeout, not a total-capture limit. Every tile
      // refreshes it so very long pages can complete normally.
      this.session.watchdog = setTimeout(() => this.restore(), 60000);
    },

    setPersistentVisibility(tile) {
      for (const item of this.session.persistentElements) {
        const style = getComputedStyle(item.element);
        const rect = item.element.getBoundingClientRect();
        let keep = true;

        if (item.position === "fixed") {
          const topAnchored = style.top !== "auto";
          const bottomAnchored = style.bottom !== "auto";
          keep = tile.isLeft && (
            (topAnchored && tile.isTop) ||
            (bottomAnchored && tile.isBottom) ||
            (!topAnchored && !bottomAnchored && tile.isTop)
          );
        } else {
          const top = style.top === "auto" ? null : Number.parseFloat(style.top);
          const bottom = style.bottom === "auto" ? null : Number.parseFloat(style.bottom);
          const stuckAtTop = top !== null && Math.abs(rect.top - top) < 2;
          const stuckAtBottom = bottom !== null && Math.abs(window.innerHeight - rect.bottom - bottom) < 2;

          if (stuckAtTop) keep = tile.isLeft && tile.isTop;
          if (stuckAtBottom) keep = tile.isLeft && tile.isBottom;
        }

        if (!keep) item.element.style.setProperty("visibility", "hidden", "important");
      }
    },

    async prepare() {
      await this.restore();

      const root = document.documentElement;
      const body = document.body;
      const styleElement = document.createElement("style");
      styleElement.dataset.pageScreenshotTool = "capture";
      styleElement.textContent = `
        html, body { scroll-behavior: auto !important; scroll-snap-type: none !important; }
        *, *::before, *::after {
          animation-play-state: paused !important;
          caret-color: transparent !important;
          scroll-snap-align: none !important;
          scroll-snap-stop: normal !important;
        }
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      `;

      this.session = {
        originalX: window.scrollX,
        originalY: window.scrollY,
        rootScrollBehavior: root.style.scrollBehavior,
        bodyScrollBehavior: body?.style.scrollBehavior || "",
        styleElement,
        persistentElements: [],
        watchdog: null
      };

      root.style.scrollBehavior = "auto";
      if (body) body.style.scrollBehavior = "auto";
      (document.head || root).appendChild(styleElement);
      await this.nextPaint(40);
      this.session.persistentElements = this.findPersistentElements();
      this.armWatchdog();
      return this.readMetrics();
    },

    async stabilize() {
      if (!this.session) throw new Error("The full-page capture session expired. Please try again.");

      // A short measurement pass triggers ordinary lazy-loaded sections before
      // tile positions and the final canvas size are fixed.
      this.showPersistentElements();
      let metrics = this.readMetrics();
      let targetY = 0;
      let step = 0;
      const maximumSteps = 160;

      while (step < maximumSteps) {
        const maximumY = Math.max(0, metrics.totalHeight - metrics.viewportHeight);
        if (targetY >= maximumY) {
          await this.nextPaint(180);
          const settled = this.readMetrics();
          if (settled.totalHeight <= metrics.totalHeight + 1) {
            metrics = settled;
            break;
          }
          metrics = settled;
        }

        targetY = Math.min(targetY + metrics.viewportHeight, Math.max(0, metrics.totalHeight - metrics.viewportHeight));
        window.scrollTo({ left: 0, top: targetY, behavior: "auto" });
        await this.nextPaint(55);
        metrics = this.readMetrics();
        this.armWatchdog();
        step += 1;
      }

      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      await this.nextPaint(100);
      this.armWatchdog();
      return this.readMetrics();
    },

    async scroll(tile) {
      if (!this.session) throw new Error("The full-page capture session expired. Please try again.");

      this.armWatchdog();
      this.showPersistentElements();
      window.scrollTo({ left: tile.x, top: tile.y, behavior: "auto" });
      await this.nextPaint(110);
      this.setPersistentVisibility(tile);
      await this.nextPaint(35);

      const metrics = this.readMetrics();
      return { x: metrics.scrollX, y: metrics.scrollY, viewportWidth: metrics.viewportWidth, viewportHeight: metrics.viewportHeight };
    },

    async restore() {
      if (!this.session) return { restored: true };
      const session = this.session;
      this.session = null;
      clearTimeout(session.watchdog);

      for (const item of session.persistentElements) {
        if (item.originalVisibility) {
          item.element.style.setProperty("visibility", item.originalVisibility, item.originalPriority);
        } else {
          item.element.style.removeProperty("visibility");
        }
      }
      session.styleElement.remove();
      document.documentElement.style.scrollBehavior = session.rootScrollBehavior;
      if (document.body) document.body.style.scrollBehavior = session.bodyScrollBehavior;
      window.scrollTo({ left: session.originalX, top: session.originalY, behavior: "auto" });
      await this.nextPaint();
      return { restored: true };
    }
  };

  globalThis.__PAGE_SCREENSHOT_TOOL__ = capture;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    let operation;
    if (message?.type === "PST_PREPARE") operation = capture.prepare();
    if (message?.type === "PST_STABILIZE") operation = capture.stabilize();
    if (message?.type === "PST_SCROLL") operation = capture.scroll(message.tile);
    if (message?.type === "PST_RESTORE") operation = capture.restore();
    if (!operation) return false;

    operation
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();
