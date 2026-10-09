// 左侧目录的章节页：右侧内容滚到顶或底后，再滚滚轮就进入上一章或下一章。
// 产品文件（.pdp-layout）和需求/详细设计（.srs-tree-layout）共用。

const COOLDOWN_MS = 480;
let lockedUntil = 0;

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

const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    const deltaY = event.deltaY;
    if (!deltaY) return;
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest) return;
    if (target.closest(".ant-modal, .ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown")) return;
    const layout = findLayout(target);
    if (!layout) return;
    if (stillScrollable(target, layout.editor, deltaY)) return;
    const index = layout.items.findIndex((item) => item.classList.contains("active"));
    if (index < 0) return;
    const next = deltaY > 0 ? layout.items[index + 1] : layout.items[index - 1];
    if (!next) return;
    event.preventDefault();
    if (Date.now() < lockedUntil) return;
    lockedUntil = Date.now() + COOLDOWN_MS;
    next.click();
    next.scrollIntoView({ block: "nearest" });
    const goDown = deltaY > 0;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            layout.editor.scrollTop = goDown ? 0 : layout.editor.scrollHeight;
        });
    });
};

if (!(window as unknown as { __qmsChapterWheel?: boolean }).__qmsChapterWheel) {
    (window as unknown as { __qmsChapterWheel?: boolean }).__qmsChapterWheel = true;
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
}
