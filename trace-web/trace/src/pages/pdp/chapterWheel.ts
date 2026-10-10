// 左侧目录的章节页：右侧内容滚到顶或底后，再滚过一段距离才进入上一章或下一章。
// 一次滑动的惯性不会连跳多章。产品文件（.pdp-layout）和需求/详细设计（.srs-tree-layout）共用。

const COOLDOWN_MS = 700;
const QUIET_MS = 360;
const EDGE_DELTA = 140;
let lockedUntil = 0;
let lastWheelAt = 0;
let armed = 0;
let armTimer = 0;
let suppressUntilQuiet = false;

type Layout = { editor: HTMLElement; items: HTMLElement[] };

const layouts: Array<{ root: string; editor: string; item: string }> = [
    { root: ".pdp-layout", editor: ".pdp-editor", item: ".pdp-nav .pdp-nav-item" },
    { root: ".srs-tree-layout", editor: ".srs-tree-editor", item: ".srs-nav-item" },
];

const findLayout = (target: HTMLElement): Layout | null => {
    for (const spec of layouts) {
        const editor = target.closest(spec.editor) as HTMLElement | null;
        const root = editor?.closest(spec.root) as HTMLElement | null;
        if (!editor || !root) continue;
        const items = [...root.querySelectorAll(spec.item)] as HTMLElement[];
        if (items.length) return { editor, items };
    }
    return null;
};

const canScroll = (el: HTMLElement, deltaY: number): boolean => {
    const style = getComputedStyle(el);
    const oy = style.overflowY;
    if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") return false;
    if (el.scrollHeight <= el.clientHeight + 2) return false;
    if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    return el.scrollTop > 2;
};

const stillScrollable = (start: HTMLElement, boundary: HTMLElement, deltaY: number): boolean => {
    let el: HTMLElement | null = start;
    while (el) {
        if (canScroll(el, deltaY)) return true;
        if (el === boundary) break;
        el = el.parentElement;
    }
    return false;
};

const wheelPixels = (event: WheelEvent) => {
    if (event.deltaMode === 1) return event.deltaY * 40;
    if (event.deltaMode === 2) return event.deltaY * 400;
    return event.deltaY;
};

const showChapterStart = (editor: HTMLElement) => {
    const apply = () => {
        editor.scrollTop = 0;
    };
    apply();
    requestAnimationFrame(() => requestAnimationFrame(apply));
    window.setTimeout(apply, 0);
    window.setTimeout(apply, 60);
    window.setTimeout(apply, 160);
};

const onNavClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest) return;
    const item = target.closest(".pdp-nav-item, .srs-nav-item");
    if (!item) return;
    const root = item.closest(".pdp-layout, .srs-tree-layout");
    const editor = root?.querySelector(".pdp-editor, .srs-tree-editor") as HTMLElement | null;
    if (editor) showChapterStart(editor);
};

const resetArm = () => {
    armed = 0;
    window.clearTimeout(armTimer);
};

const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    const deltaY = wheelPixels(event);
    if (!deltaY) return;
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest) return;
    if (target.closest(".ant-modal, .ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown")) return;
    const layout = findLayout(target);
    if (!layout) return;
    if (stillScrollable(target, layout.editor, deltaY)) {
        resetArm();
        return;
    }
    const index = layout.items.findIndex((item) => item.classList.contains("active"));
    if (index < 0) return;
    const next = deltaY > 0 ? layout.items[index + 1] : layout.items[index - 1];
    if (!next) return;
    event.preventDefault();
    const now = Date.now();
    if (now < lockedUntil) {
        lastWheelAt = now;
        return;
    }
    if (suppressUntilQuiet) {
        if (now - lastWheelAt < QUIET_MS) {
            lastWheelAt = now;
            return;
        }
        suppressUntilQuiet = false;
        resetArm();
    }
    if (now - lastWheelAt > QUIET_MS || Math.sign(deltaY) !== Math.sign(armed)) resetArm();
    lastWheelAt = now;
    armed += deltaY;
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(resetArm, QUIET_MS);
    if (Math.abs(armed) < EDGE_DELTA) return;
    resetArm();
    lockedUntil = now + COOLDOWN_MS;
    suppressUntilQuiet = true;
    next.click();
    next.scrollIntoView({ block: "nearest" });
    showChapterStart(layout.editor);
};

if (!(window as unknown as { __qmsChapterWheel?: boolean }).__qmsChapterWheel) {
    (window as unknown as { __qmsChapterWheel?: boolean }).__qmsChapterWheel = true;
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    document.addEventListener("click", onNavClick, true);
}
