/** 文档内运行环境：章节可改标题/可删；自动获取的正文与表格只读。 */

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
    // 详细设计同步来的字段表 / 接口内嵌表，不按运行环境只读
    const title = String(node?.title || "").trim();
    if (/^导入表格\d*$/.test(title)) return false;
    const h0 = String(node?.table?.headers?.[0]?.name || "").replace(/\s+/g, "");
    if (h0 === "字段ID" || h0 === "FieldID" || h0 === "Name") return false;
    const t = String(node?.title || "");
    const plain = stripRuntimeTitle(t);
    if (t.includes("确认运行环境") || plain.includes("确认运行环境")) return false;
    const tableName = String(node?.table?.name || "");
    const isRuntimeTableCaption = (s: string) =>
        /表\s*[1-4]/.test(s) && /(硬件|软件|用户端|网络)/.test(s);
    // 须同时带「表1~4」与硬件/软件/用户端/网络语义，避免同步库表/接口表被误锁
    if (isRuntimeTableCaption(tableName) || isRuntimeTableCaption(t)) return true;
    return (
        plain.startsWith("服务器硬件") ||
        plain.includes("硬件环境") ||
        plain.includes("服务器软件") ||
        plain.includes("软件环境") ||
        plain.includes("配置见表") ||
        plain.startsWith("用户端") ||
        (plain.includes("网络") && (plain.includes("条件") || plain.includes("要求")))
    );
}

/** 「运行环境」章及其子孙：正文/表格只读。 */
export function collectRuntimeLockedContentIds(nodes: any[]): Set<string> {
    const ids = new Set<string>();
    const walk = (list: any[], underRuntime: boolean) => {
        for (const n of list || []) {
            const section = isRuntimeEnvSection(n);
            const under = underRuntime || section;
            if (under || isRuntimeTableNode(n)) {
                if (n?.id != null) ids.add(String(n.id));
            }
            walk(n?.children || [], under);
        }
    };
    walk(nodes || [], false);
    return ids;
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
