/** 文档内运行环境章节：只读，统一从「产品管理 → 运行环境」获取，不允许改/删。 */

export function stripRuntimeTitle(title: string): string {
    return String(title || "").replace(/^\s*\d+(?:\.\d+)*[\.、\s]*/, "").trim();
}

const TABLE_REFS = new Set(["rt_srv_hw", "rt_srv_sw", "rt_client", "rt_net", "rt_hw", "rt_sw", "rt_net"]);
const SECTION_REFS = new Set(["runtime", "runtime_env"]);

export function isRuntimeEnvSection(node: any): boolean {
    const t = String(node?.title || "");
    const plain = stripRuntimeTitle(t);
    if (t.includes("确认运行环境") || plain.includes("确认运行环境")) return false;
    const ref = String(node?.ref_type || "");
    if (SECTION_REFS.has(ref)) return true;
    return t.includes("运行环境") || plain === "运行环境";
}

export function isRuntimeTableNode(node: any): boolean {
    if (TABLE_REFS.has(String(node?.ref_type || ""))) return true;
    if (isRuntimeEnvSection(node)) return false;
    const t = String(node?.title || "");
    const plain = stripRuntimeTitle(t);
    if (t.includes("确认运行环境")) return false;
    return (
        t.includes("表1") ||
        plain.startsWith("服务器硬件") ||
        t.includes("表2") ||
        plain.includes("服务器软件") ||
        t.includes("表3") ||
        plain.startsWith("用户端") ||
        t.includes("表4") ||
        (plain.includes("网络") && (plain.includes("条件") || plain.includes("要求") || t.includes("表")))
    );
}

export function isRuntimeLockedNode(node: any): boolean {
    return isRuntimeEnvSection(node) || isRuntimeTableNode(node);
}

export function isRuntimeLockedBody(node: any): boolean {
    return isRuntimeEnvSection(node);
}

/** 父节点挂 4+ 张表时只锁前 4 张（STP/UTP 第 5 张测试设备可改）。 */
export function isRuntimeLockedTable(node: any, tableIndex: number): boolean {
    if (isRuntimeTableNode(node)) return true;
    if (!isRuntimeEnvSection(node)) return false;
    const n = Array.isArray(node?.tables) ? node.tables.length : 0;
    if (n >= 4) return tableIndex < 4;
    return true;
}
