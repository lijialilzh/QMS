import { TreeNode } from "../sds_doc/components/TreeStructure";

export type HldTableData = {
    name?: string | null;
    show_header?: number;
    headers?: Array<{ code: string; name: string }>;
    rows?: Array<Record<string, string>>;
    cells?: Array<Array<{ value?: string; row_span?: number; col_span?: number; h_align?: string; v_align?: string }>>;
};

export type HldSdsSyncPayload = {
    sds_doc_id?: number;
    interface_table?: HldTableData | null;
    interface_details?: Array<{ name: string; source_title?: string; text: string }>;
    field_tables?: Array<{ title: string; library: "lib1" | "lib2"; table: HldTableData }>;
};

const SECTION_RANGES = [
    { prefix: "3.3.1", from: 1, to: 3 },
    { prefix: "3.3.2", from: 4, to: 6 },
    { prefix: "3.3.3", from: 7, to: 11 },
    { prefix: "3.3.4", from: 12, to: 32 },
];

const MODULE_BY_SEQ: Record<number, string> = {
    1: "DP",
};

const moduleForSeq = (seq: number): string => {
    if (MODULE_BY_SEQ[seq]) return MODULE_BY_SEQ[seq];
    if (seq >= 2 && seq <= 3) return "DP，RePACS";
    if (seq >= 4 && seq <= 6) return "DLServer，RePACS";
    if (seq >= 7 && seq <= 11) return "NeoViewer，RePACS";
    return "NeoViewer";
};

const normalizeTitle = (value?: string) => String(value || "").replace(/\s+/g, "").replace(/[.．、]/g, ".");

const parseInterfaceSeq = (code?: string): number => {
    const txt = String(code || "").trim();
    const m = txt.match(/-(\d+)$/);
    return m ? parseInt(m[1], 10) || 0 : 0;
};

const cloneTable = (table: HldTableData): HldTableData => JSON.parse(JSON.stringify(table || {}));

const buildRowsFromHeaders = (
    headers: Array<{ code: string; name: string }>,
    rows: Array<Record<string, string>>,
): HldTableData => {
    const cells = [
        headers.map((header) => ({
            value: header.name,
            row_span: 1,
            col_span: 1,
            h_align: "center",
            v_align: "middle",
        })),
        ...rows.map((row) => headers.map((header) => ({
            value: String(row[header.code] ?? ""),
            row_span: 1,
            col_span: 1,
            h_align: "left",
            v_align: "middle",
        }))),
    ];
    return { headers, rows, cells, show_header: 1, name: undefined };
};

const mapSdsInterfaceRows = (table?: HldTableData | null) => {
    const rows = table?.rows || [];
    return rows.map((row) => ({
        code: String(row.col_1 ?? "").trim(),
        name: String(row.col_2 ?? "").trim(),
        url: String(row.col_3 ?? "").trim(),
        input: String(row.col_4 ?? "").trim(),
        output: String(row.col_5 ?? "").trim(),
        seq: parseInterfaceSeq(row.col_1),
    })).filter((row) => row.code || row.name);
};

const buildSummaryTable = (masterRows: ReturnType<typeof mapSdsInterfaceRows>): HldTableData => {
    const headers = [
        { code: "col_1", name: "接口设计编号" },
        { code: "col_2", name: "涉及模块" },
        { code: "col_3", name: "功能" },
    ];
    const rows = masterRows.map((row) => ({
        col_1: row.code,
        col_2: moduleForSeq(row.seq),
        col_3: row.name,
    }));
    return buildRowsFromHeaders(headers, rows);
};

const buildDetailTable = (masterRows: ReturnType<typeof mapSdsInterfaceRows>): HldTableData => {
    const headers = [
        { code: "col_1", name: "接口设计编号" },
        { code: "col_2", name: "接口名称" },
        { code: "col_3", name: "URL" },
        { code: "col_4", name: "输入参数" },
        { code: "col_5", name: "输出参数" },
    ];
    const rows = masterRows.map((row) => ({
        col_1: row.code,
        col_2: row.name,
        col_3: row.url,
        col_4: row.input,
        col_5: row.output,
    }));
    return buildRowsFromHeaders(headers, rows);
};

const convertFieldTable = (table?: HldTableData | null): HldTableData | null => {
    if (!table?.headers?.length) return null;
    const headerMap: Record<string, string> = {
        "字段ID": "Field ID",
        "字段名称": "Field Name",
        "字段类型": "Field Type",
        "字段长度": "Field Length",
    };
    const headers = table.headers.map((header, idx) => ({
        code: header.code || `col_${idx + 1}`,
        name: headerMap[header.name] || header.name,
    }));
    const rows = (table.rows || []).map((row) => {
        const next: Record<string, string> = {};
        headers.forEach((header, idx) => {
            const srcCode = table.headers?.[idx]?.code || header.code;
            next[header.code] = String(row[srcCode] ?? "");
        });
        return next;
    });
    return buildRowsFromHeaders(headers, rows);
};

const findNodeByTitle = (nodes: TreeNode[], matcher: (title: string) => boolean): TreeNode | null => {
    for (const node of nodes || []) {
        if (matcher(String(node.title || ""))) return node;
        const child = findNodeByTitle((node.children || []) as TreeNode[], matcher);
        if (child) return child;
    }
    return null;
};

const walkTree = (nodes: TreeNode[], fn: (node: TreeNode, parents: TreeNode[]) => TreeNode | void, parents: TreeNode[] = []): TreeNode[] =>
    (nodes || []).map((node) => {
        const currentParents = [...parents, node];
        const mapped = fn(node, parents) || node;
        const children = walkTree((mapped.children || node.children || []) as TreeNode[], fn, currentParents);
        return { ...mapped, children };
    });

const ensureChapter4Structure = (nodes: TreeNode[]): TreeNode[] => walkTree(nodes, (node) => {
    const title = String(node.title || "");
    if (!(/^4[\s.．、]/.test(title) && title.includes("数据结构") && !/^4\.[0-9]/.test(title.replace(/\s/g, "")))) {
        return node;
    }
    const children = [...((node.children || []) as TreeNode[])];
    let section41 = children.find((item) => normalizeTitle(item.title).startsWith("4.1"));
    if (!section41) {
        section41 = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            doc_id: node.doc_id || 0,
            n_id: 0,
            p_id: node.n_id || 0,
            title: "4.1 逻辑结构设计要点",
            text: String(node.children?.[0]?.text || ""),
            table: {},
            children: [],
        } as TreeNode;
        children.unshift(section41);
    }
    const sec41Children = [...((section41.children || []) as TreeNode[])];
    if (!sec41Children.some((item) => normalizeTitle(item.title).includes("4.1.1"))) {
        sec41Children.unshift({
            id: Date.now() + Math.floor(Math.random() * 1000),
            doc_id: section41.doc_id || 0,
            n_id: 0,
            p_id: section41.n_id || 0,
            title: "4.1.1 图像数据与处理结果",
            text: "",
            table: {},
            children: [],
        } as TreeNode);
    }
    if (!sec41Children.some((item) => normalizeTitle(item.title).includes("4.1.2"))) {
        sec41Children.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            doc_id: section41.doc_id || 0,
            n_id: 0,
            p_id: section41.n_id || 0,
            title: "4.1.2 标记信息",
            text: "",
            table: {},
            children: [],
        } as TreeNode);
    }
    const sec41Idx = children.findIndex((item) => item === section41);
    children[sec41Idx] = { ...section41, children: sec41Children };
    if (!children.some((item) => normalizeTitle(item.title).startsWith("4.2"))) {
        children.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            doc_id: node.doc_id || 0,
            n_id: 0,
            p_id: node.n_id || 0,
            title: "4.2 物理结构设计要点",
            text: "",
            table: {},
            children: [],
        } as TreeNode);
    }
    return { ...node, children };
});

const upsertFieldTableNode = (nodes: TreeNode[], item: { title: string; library: "lib1" | "lib2"; table: HldTableData }) => {
    const normalized = normalizeTitle(item.title);
    const converted = convertFieldTable(item.table);
    if (!converted) return nodes;
    const existing = findNodeByTitle(nodes, (title) => normalizeTitle(title) === normalized);
    if (existing) {
        return walkTree(nodes, (node) => (
            normalizeTitle(node.title) === normalized ? { ...node, table: converted as TreeNode["table"] } : node
        ));
    }
    const parentTitle = item.library === "lib2" ? "4.2 物理结构设计要点" : "4.1.1 图像数据与处理结果";
    return walkTree(nodes, (node) => {
        if (normalizeTitle(node.title) !== normalizeTitle(parentTitle)) return node;
        const children = [...((node.children || []) as TreeNode[])];
        children.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            doc_id: node.doc_id || 0,
            n_id: 0,
            p_id: node.n_id || 0,
            title: item.title,
            text: "",
            table: converted as TreeNode["table"],
            children: [],
        } as TreeNode);
        return { ...node, children };
    });
};

const SECTION_INTRO_TEXT: Record<string, string> = {
    "3.3.1": "DataProcessing与RePACS的接口\n主要是用来定义DataProcessing模块发送给RePACS模块的图像数据和处理任务接口。RePACS模块通过接收/响应HTTP/HTTPS请求，数据使用JSON格式进行编码，使用null值作为缺省属性值。DataProcessing上传请求数据时需要指定Content-Type为application/json。",
    "3.3.2": "RePACS与DLServer的接口\n主要是用来定义DLServer模块向RePACS模块获取预处理任务和保存预处理结果的接口。",
    "3.3.3": "RePACS与NeoViewer的接口",
    "3.3.4": "NeoViewer的接口",
};

const preserveSectionIntroText = (title: string, text?: string): string => {
    const section = SECTION_RANGES.find((item) => normalizeTitle(title).startsWith(normalizeTitle(item.prefix)));
    if (section && SECTION_INTRO_TEXT[section.prefix]) {
        return SECTION_INTRO_TEXT[section.prefix];
    }
    const raw = String(text || "").trim();
    if (!raw || raw.length <= 220) return raw;
    return raw.split("\n\n")[0].trim() || raw.split("\n")[0].trim();
};

const isSectionNode = (title: string) =>
    SECTION_RANGES.some((item) => normalizeTitle(title).startsWith(normalizeTitle(item.prefix)));

const normalizeInterfaceName = (value?: string) =>
    String(value || "").replace(/\s+/g, "").replace(/接口$/g, "").trim();

let tempNodeSeed = 0;
const nextTempNodeId = () => Date.now() + (++tempNodeSeed) + Math.floor(Math.random() * 1000);

const findInterfaceDetail = (
    details: HldSdsSyncPayload["interface_details"],
    interfaceName: string,
) => {
    const target = normalizeInterfaceName(interfaceName);
    if (!target) return undefined;
    return (details || []).find((item) => {
        const name = normalizeInterfaceName(item.name);
        const source = normalizeInterfaceName(item.source_title);
        return name === target || source === target || name.includes(target) || target.includes(name);
    });
};

const buildInterfaceDetailChildren = (
    sectionRows: ReturnType<typeof mapSdsInterfaceRows>,
    details: HldSdsSyncPayload["interface_details"],
    docId = 0,
): TreeNode[] =>
    sectionRows.map((row, index) => {
        const detail = findInterfaceDetail(details, row.name);
        return {
            id: nextTempNodeId(),
            doc_id: docId,
            n_id: 0,
            p_id: 0,
            title: `${index + 1}. ${row.name}`,
            text: detail?.text || "",
            table: {},
            children: [],
        } as TreeNode;
    });

const childHasDetailTable = (child: TreeNode) =>
    Array.isArray(child.table?.rows) && (child.table?.rows?.length || 0) > 0;

export const stripLegacyInterfaceText = (tree: TreeNode[]): TreeNode[] =>
    walkTree(tree, (node) => {
        const title = String(node.title || "");
        if (!isSectionNode(title)) return node;
        if (String(node.text || "").length <= 260 && !(node.children || []).length) return node;
        return {
            ...node,
            text: preserveSectionIntroText(title, node.text),
            table: {},
            children: [],
        };
    });

export const needsLegacyInterfaceRepair = (tree: TreeNode[]): boolean => {
    let legacy = false;
    walkTree(tree, (node) => {
        const title = String(node.title || "");
        if (!isSectionNode(title)) return;
        const textLen = String(node.text || "").length;
        const children = (node.children || []) as TreeNode[];
        const parentRowCount = Array.isArray(node.table?.rows) ? (node.table.rows?.length || 0) : 0;
        if (textLen > 260) legacy = true;
        if (children.some((child) => childHasDetailTable(child))) legacy = true;
        if (parentRowCount > 0) {
            const detailChildren = children.filter((child) => !childHasDetailTable(child));
            if (detailChildren.length !== parentRowCount) legacy = true;
        }
    });
    return legacy;
};

export const applySdsSyncToTree = (tree: TreeNode[], payload?: HldSdsSyncPayload | null): TreeNode[] => {
    if (!payload) return tree;
    tempNodeSeed = 0;
    let nextTree = ensureChapter4Structure([...(tree || [])]);
    const masterRows = mapSdsInterfaceRows(payload.interface_table);
    const interfaceDetails = payload.interface_details || [];
    if (masterRows.length > 0) {
        const summaryTable = buildSummaryTable(masterRows);
        nextTree = walkTree(nextTree, (node) => {
            const title = String(node.title || "");
            if (/^3[\s.．、]/.test(title) && title.includes("接口") && !/^3\.[0-9]/.test(title.replace(/\s/g, ""))) {
                return { ...node, table: cloneTable(summaryTable) as TreeNode["table"] };
            }
            const section = SECTION_RANGES.find((item) => normalizeTitle(title).startsWith(normalizeTitle(item.prefix)));
            if (section) {
                const sectionRows = masterRows.filter((row) => row.seq >= section.from && row.seq <= section.to);
                if (sectionRows.length > 0) {
                    return {
                        ...node,
                        text: preserveSectionIntroText(title, node.text),
                        table: cloneTable(buildDetailTable(sectionRows)) as TreeNode["table"],
                        children: buildInterfaceDetailChildren(sectionRows, interfaceDetails, node.doc_id || 0),
                    };
                }
            }
            return node;
        });
    }
    (payload.field_tables || []).forEach((item) => {
        nextTree = upsertFieldTableNode(nextTree, item);
    });
    return nextTree;
};

export const hasSdsSyncData = (payload?: HldSdsSyncPayload | null) =>
    !!(payload?.interface_table?.rows?.length || payload?.interface_details?.length || payload?.field_tables?.length);
