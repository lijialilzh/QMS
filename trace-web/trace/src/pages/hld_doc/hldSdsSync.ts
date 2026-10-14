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
    interface_details?: Array<{ name: string; source_title?: string; text: string; tables?: Array<{ title?: string; table: HldTableData }> }>;
    field_tables?: Array<{ title: string; library: "lib1" | "lib2"; table: HldTableData }>;
    glossary_table?: HldTableData | null;
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

const isSectionNode = (title: string) => {
    const compact = normalizeTitle(title);
    if (!/DataProcessing|DLServer|RePACS|NeoViewer|与/.test(String(title || ""))) return false;
    return SECTION_RANGES.some((item) => compact.startsWith(normalizeTitle(item.prefix)));
};

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
            const isLegacyGroup = /DataProcessing|DLServer|RePACS|NeoViewer|与/.test(title);
            if (section && isLegacyGroup) {
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
    nextTree = applyGlossaryTable(nextTree, payload.glossary_table);
    nextTree = splitHldInternalInterfaces(nextTree).nodes;
    return mergeInterfaceDetails(nextTree, interfaceDetails);
};

const headerNamesOf = (node?: TreeNode | null) =>
    (node?.table?.headers || []).map((header) => String(header?.name || "").replace(/\s/g, ""));

const isInterfaceSummaryNode = (node?: TreeNode | null) => {
    const names = headerNamesOf(node);
    return names.includes("接口设计编号") && (names.includes("功能") || names.includes("接口名称") || names.includes("涉及模块"));
};

const findTreeNode = (nodes: TreeNode[], matcher: (node: TreeNode) => boolean): TreeNode | null => {
    for (const node of nodes || []) {
        if (matcher(node)) return node;
        const child = findTreeNode((node.children || []) as TreeNode[], matcher);
        if (child) return child;
    }
    return null;
};

const isInternalInterfaceTitle = (title?: string) => {
    const compact = String(title || "").replace(/\s+/g, "");
    return /^3\.3(?!\.\d)/.test(compact) && compact.includes("内部接口");
};

const interfaceNamesFromNode = (node?: TreeNode | null): string[] => {
    const rows = node?.table?.rows || [];
    const headers = node?.table?.headers || [];
    const nameHeader = headers.find((header) => {
        const name = String(header?.name || "").replace(/\s/g, "");
        return name === "功能" || name === "接口名称";
    });
    const code = nameHeader?.code || "col_3";
    return rows.map((row) => String(row?.[code] || "").trim()).filter(Boolean);
};

const collectInterfaceNames = (tree: TreeNode[]): string[] => {
    const found: string[] = [];
    const walk = (nodes: TreeNode[]) => {
        (nodes || []).forEach((node) => {
            if (isInterfaceSummaryNode(node)) {
                interfaceNamesFromNode(node).forEach((name) => {
                    if (!found.includes(name)) found.push(name);
                });
            }
            (node.children || []).forEach((child) => {
                if (/^导入表格\d*$/.test(String(child.title || "").trim()) && isInterfaceSummaryNode(child)) {
                    interfaceNamesFromNode(child).forEach((name) => {
                        if (!found.includes(name)) found.push(name);
                    });
                }
            });
            walk((node.children || []) as TreeNode[]);
        });
    };
    walk(tree || []);
    return found;
};

const INTERFACE_NAME_ALIASES: Record<string, string[]> = {
    "获取处理任务结果": ["获取处理任务接口"],
    "添加事件接口": ["新建事件接口"],
};

const interfaceNamesMatch = (left?: string, right?: string) => {
    const a = normalizeInterfaceName(left);
    const b = normalizeInterfaceName(right);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const aliases = [
        ...(INTERFACE_NAME_ALIASES[String(left || "").replace(/\s+/g, "")] || []),
        ...(INTERFACE_NAME_ALIASES[String(right || "").replace(/\s+/g, "")] || []),
    ].map((name) => normalizeInterfaceName(name));
    return aliases.some((name) => name === a || name === b);
};

const isImportedTableChild = (node?: TreeNode | null) =>
    /^导入表格\d*$/.test(String(node?.title || "").trim()) && !!(node?.table?.headers || []).length;

const mergeInterfaceDetails = (tree: TreeNode[], details: HldSdsSyncPayload["interface_details"]): TreeNode[] => {
    if (!details?.length) return tree;
    return walkTree(tree, (node) => {
        const title = String(node.title || "");
        if (!/^3\.3\.\d+/.test(normalizeTitle(title))) return node;
        const detail = details.find((item) => interfaceNamesMatch(title, item.name) || interfaceNamesMatch(title, item.source_title));
        if (!detail) return node;
        const kept = ((node.children || []) as TreeNode[]).filter((child) => !isImportedTableChild(child));
        const tableChildren = (detail.tables || []).filter((item) => item?.table?.headers?.length).map((item, index) => {
            const rawTitle = String(item.title || "").trim();
            return {
                id: nextTempNodeId(),
                doc_id: node.doc_id || 0,
                n_id: 0,
                p_id: node.n_id || 0,
                title: /^导入表格\d*$/.test(rawTitle) ? rawTitle : `导入表格${index + 1}`,
                text: "",
                table: item.table,
                children: [],
            } as TreeNode;
        });
        if (!detail.text && tableChildren.length === 0) return node;
        return {
            ...node,
            text: detail.text || node.text,
            children: [...kept, ...tableChildren],
        };
    });
};

const sliceInterfaceBodies = (text: string, names: string[]): { intro: string; bodies: string[] } => {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const starts = names.map((name) => {
        const candidates = [name, ...(INTERFACE_NAME_ALIASES[name] || [])];
        return lines.findIndex((line) => {
            const compact = String(line || "").replace(/\s+/g, "");
            return candidates.some((candidate) => compact.endsWith(candidate) && compact.length <= candidate.length + 24);
        });
    });
    const firstStart = starts.filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
    const intro = (firstStart === undefined ? lines : lines.slice(0, firstStart))
        .filter((line) => !/^\s*\d+(?:\.\d+){2,}\.\s+/.test(String(line || "").trim()))
        .join("\n")
        .trim();
    const bodies = names.map((name, index) => {
        const start = starts[index];
        if (start < 0) return "";
        let end = lines.length;
        starts.forEach((other) => {
            if (other > start && other < end) end = other;
        });
        const chunk = lines.slice(start, end).join("\n").trim();
        return chunk.replace(/^\s*\d+(?:\.\d+)*\.\s*/, "").trim();
    });
    return { intro, bodies };
};

export const splitHldInternalInterfaces = (tree: TreeNode[]): { nodes: TreeNode[]; changed: boolean } => {
    const names = collectInterfaceNames(tree);
    const internal = findTreeNode(tree || [], (node) => isInternalInterfaceTitle(node.title));
    if (!internal || names.length === 0) return { nodes: tree, changed: false };
    const children = (internal.children || []) as TreeNode[];
    const hasKeptText = children.some((child) => /^3\.3\.\d+/.test(normalizeTitle(child.title)) && String(child.text || "").trim());
    if (hasKeptText) return { nodes: tree, changed: false };
    const already = names.every((name) => children.some((child) => String(child.title || "").includes(name)));
    if (already) return { nodes: tree, changed: false };
    const { intro, bodies } = sliceInterfaceBodies(String(internal.text || ""), names);
    const chapters = names.map((name, index) => ({
        id: nextTempNodeId(),
        doc_id: internal.doc_id || 0,
        n_id: 0,
        p_id: internal.n_id || 0,
        title: `3.3.${index + 1} ${name}`,
        text: bodies[index] || "",
        table: {},
        children: [],
    })) as TreeNode[];
    let changed = false;
    const next = walkTree(tree, (node) => {
        if (!isInternalInterfaceTitle(node.title)) return node;
        changed = true;
        return {
            ...node,
            text: intro,
            table: {},
            children: chapters,
        };
    });
    return { nodes: changed ? next : tree, changed };
};

const isGlossaryTableData = (table?: HldTableData | TreeNode["table"] | null) => {
    const names = (table?.headers || []).map((header) => String(header?.name || "").replace(/\s/g, "").toLowerCase());
    if (names.length < 2) return false;
    const hasTerm = names.some((name) => name.includes("术语") || name.includes("缩写") || name.includes("abbreviation") || name.startsWith("term"));
    const hasDef = names.some((name) => name.includes("定义") || name.includes("definition"));
    return hasTerm && hasDef;
};

const applyGlossaryTable = (tree: TreeNode[], table?: HldTableData | null): TreeNode[] => {
    if (!table?.headers?.length || !table?.rows?.length) return tree;
    return walkTree(tree, (node) => {
        const title = String(node.title || "").trim();
        if (!(/术语/.test(title) && /^\s*1\.4(?:\s|$|[、.．])/.test(title))) return node;
        const children = ((node.children || []) as TreeNode[]).filter((child) => {
            const childTitle = String(child.title || "").trim();
            return !(/^导入表格\d*$/.test(childTitle) && isGlossaryTableData(child.table));
        });
        return { ...node, table: cloneTable(table) as TreeNode["table"], children };
    });
};

const isImportedFieldTableNode = (node?: TreeNode | null) => {
    const title = String(node?.title || "").trim();
    if (!/^导入表格\d*$/.test(title)) return false;
    const header = String(node?.table?.headers?.[0]?.name || "").replace(/\s/g, "");
    return header === "FieldID" || header === "字段ID";
};

const isHldFieldCaptionLine = (line: string) => {
    const txt = String(line || "").trim();
    if (!txt || txt.length > 80) return false;
    if (/^库\s*\d*数据库[:：]?\s*$/.test(txt)) return false;
    if (/^Postgresql数据库[:：]?\s*$/i.test(txt)) return false;
    if (/.+表\s*[:：]?\s*$/.test(txt)) return true;
    if (/^[A-Za-z][A-Za-z0-9_]{1,64}[:：]\s*.+$/.test(txt)) return true;
    if (/[:：]/.test(txt)) {
        const [left, right = ""] = txt.split(/[:：]/);
        return !!String(left || "").trim() && !!String(right || "").trim() && /^[A-Za-z][A-Za-z0-9_]{1,64}$/.test(String(left || "").trim());
    }
    return false;
};

const isLogicStructureTitle = (title?: string) => {
    const compact = String(title || "").replace(/\s+/g, "");
    return /^4\.1(?!\.\d)/.test(compact) && compact.includes("逻辑结构");
};

const isChapter4Title = (title?: string) => {
    const compact = String(title || "").replace(/\s+/g, "");
    return /^4(?!\.)/.test(compact) && compact.includes("数据结构");
};

/** 与详细设计一致：字段表按表名挂到目录，点开一张只显示这一张。 */
export const promoteHldFieldTables = (tree: TreeNode[]): { nodes: TreeNode[]; changed: boolean } => {
    let changed = false;
    const next = (tree || []).map((node) => {
        if (!isChapter4Title(node.title)) {
            const children = promoteHldFieldTables((node.children || []) as TreeNode[]);
            if (!children.changed) return node;
            changed = true;
            return { ...node, children: children.nodes };
        }
        const chapters = [...((node.children || []) as TreeNode[])];
        const section = chapters.find((item) => isLogicStructureTitle(item.title));
        if (!section) return node;
        const sectionChildren = [...((section.children || []) as TreeNode[])];
        const imported = sectionChildren.filter(isImportedFieldTableNode);
        if (imported.length < 2) return node;
        const lines = String(section.text || "").replace(/\r/g, "").split("\n");
        const captions = lines.map((line) => String(line || "").trim()).filter(isHldFieldCaptionLine);
        if (captions.length !== imported.length) return node;
        const lib2At = lines.findIndex((line) => /^库\s*2/.test(String(line || "").trim()));
        const lib1Count = lib2At < 0
            ? captions.length
            : lines.slice(0, lib2At).map((line) => String(line || "").trim()).filter(isHldFieldCaptionLine).length;
        const named = imported.map((item, index) => ({
            ...item,
            title: captions[index],
            table: item.table ? { ...item.table, name: captions[index] } : item.table,
        }));
        const lib1Tables = named.slice(0, lib1Count);
        const lib2Tables = named.slice(lib1Count);
        const intro = lines
            .map((line) => String(line || "").trim())
            .filter((line) => line && !isHldFieldCaptionLine(line) && !/^库\s*2/.test(line) && !/^Postgresql数据库[:：]?\s*$/i.test(line))
            .join("\n")
            .trim();
        const rest = sectionChildren.filter((item) => !isImportedFieldTableNode(item));
        let section41 = rest.find((item) => String(item.title || "").replace(/\s+/g, "").startsWith("4.1.1"));
        if (!section41) {
            section41 = {
                id: nextTempNodeId(),
                doc_id: section.doc_id || 0,
                n_id: 0,
                p_id: section.n_id || 0,
                title: "4.1.1 图像数据与处理结果",
                text: "Postgresql数据库：",
                table: {},
                children: lib1Tables,
            } as TreeNode;
            rest.unshift(section41);
        } else {
            const idx = rest.indexOf(section41);
            rest[idx] = {
                ...section41,
                text: String(section41.text || "").trim() || "Postgresql数据库：",
                children: [...((section41.children || []) as TreeNode[]), ...lib1Tables],
            };
        }
        const sectionIdx = chapters.findIndex((item) => item === section);
        chapters[sectionIdx] = { ...section, text: intro, children: rest };
        if (lib2Tables.length > 0) {
            let section42 = chapters.find((item) => String(item.title || "").replace(/\s+/g, "").startsWith("4.2"));
            if (!section42) {
                chapters.push({
                    id: nextTempNodeId(),
                    doc_id: node.doc_id || 0,
                    n_id: 0,
                    p_id: node.n_id || 0,
                    title: "4.2 物理结构设计要点",
                    text: "库2数据库：",
                    table: {},
                    children: lib2Tables,
                } as TreeNode);
            } else {
                const idx = chapters.indexOf(section42);
                chapters[idx] = {
                    ...section42,
                    text: String(section42.text || "").trim() || "库2数据库：",
                    children: [...((section42.children || []) as TreeNode[]), ...lib2Tables],
                };
            }
        }
        changed = true;
        return { ...node, children: chapters };
    });
    return { nodes: next, changed };
};

const fieldTitleKey = (node: TreeNode) => String(node.title || "").replace(/[\u200b\s]/g, "");

const dropRepeatedFieldBlock = (children: TreeNode[]): TreeNode[] => {
    const keys = children.map(fieldTitleKey);
    const again = keys.findIndex((key, index) => index > 0 && key && key === keys[0]);
    if (again <= 0) return children;
    const head = keys.slice(0, again);
    const tail = keys.slice(again);
    if (!head.every((key, index) => tail[index] === key)) return children;
    if (tail.length >= head.length) return children.slice(again);
    return children;
};

/** 去掉空的「4.1.2 标记信息」，并去掉 4.1.1 / 4.2 下整表重复挂上的那一套字段表。 */
export const tidyHldFieldChapters = (tree: TreeNode[]): { nodes: TreeNode[]; changed: boolean } => {
    let changed = false;
    const next = walkTree(tree, (node) => {
        if (!isChapter4Title(node.title) && !isLogicStructureTitle(node.title)) return node;
        let children = [...((node.children || []) as TreeNode[])];
        const before = children.map((item) => `${item.n_id}:${item.title}:${(item.children || []).length}`).join("|");
        if (isLogicStructureTitle(node.title)) {
            const dataChapter = children.find((item) => String(item.title || "").replace(/\s+/g, "").startsWith("4.1.1"));
            const dataHasTables = ((dataChapter?.children || []) as TreeNode[]).some(isImportedFieldTableNode)
                || ((dataChapter?.children || []) as TreeNode[]).some((item) => fieldTitleKey(item).length > 0 && String(item.table?.headers?.[0]?.name || "").replace(/\s/g, "").includes("Field"));
            children = children.filter((item) => {
                const title = String(item.title || "").replace(/\s+/g, "");
                if (!title.includes("标记信息")) return true;
                const hasBody = !!String(item.text || "").trim() || ((item.children || []) as TreeNode[]).length > 0;
                const rows = item.table?.rows?.length || 0;
                if (hasBody || rows > 0) return true;
                return !dataHasTables;
            });
            children = children.map((item) => {
                if (!String(item.title || "").replace(/\s+/g, "").startsWith("4.1.1")) return item;
                return { ...item, children: dropRepeatedFieldBlock((item.children || []) as TreeNode[]) };
            });
        }
        if (isChapter4Title(node.title)) {
            children = children.map((item) => {
                if (!String(item.title || "").replace(/\s+/g, "").startsWith("4.2")) return item;
                return { ...item, children: dropRepeatedFieldBlock((item.children || []) as TreeNode[]) };
            });
        }
        const after = children.map((item) => `${item.n_id}:${item.title}:${(item.children || []).length}`).join("|");
        if (before === after) return node;
        changed = true;
        return { ...node, children };
    });
    return { nodes: changed ? next : tree, changed };
};

export const hasSdsSyncData = (payload?: HldSdsSyncPayload | null) =>
    !!(payload?.interface_table?.rows?.length || payload?.interface_details?.length || payload?.field_tables?.length || payload?.glossary_table?.rows?.length);
