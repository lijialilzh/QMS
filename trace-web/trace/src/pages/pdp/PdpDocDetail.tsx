import { Button, Input, Space, Spin, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiPdpDoc";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import "./PdpDocDetail.less";

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

// 参与人员里的角色名 → 人员资源标准表里的角色名（解决「测试人员」等被误配进「用户测试人员」的问题）
const ROLE_ALIAS: Record<string, string> = {
    "测试人员": "软件测试工程师",
    "软件测试": "软件测试工程师",
    "测试工程师": "软件测试工程师",
};
const resolveRole = (role: string): string => {
    const k = String(role || "").trim();
    return ROLE_ALIAS[k] || k;
};

// 从「产品时间逻辑线」的日期行计算开发周期：开始=最早日期，结束=最后一个「有文件输出」行的日期
// 输出「YYYY 年 M 月~YYYY 年 M 月」
const computeCycle = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const hasOutput = (r: any) => Object.values(r.cells || {}).some((v: any) => String(v || "").trim());
    const dates = (rows || [])
        .filter((r: any) => (r.row_type || "date") === "date")
        .map((r: any) => ({ y: num(r.year), m: num(r.month), d: num(r.day), out: hasOutput(r) }))
        .filter((x: any) => !isNaN(x.y) && !isNaN(x.m));
    if (!dates.length) return "";
    const key = (x: any) => x.y * 10000 + x.m * 100 + (isNaN(x.d) ? 0 : x.d);
    let min = dates[0];
    dates.forEach((x: any) => { if (key(x) < key(min)) min = x; });
    // 结束日期以最后一个有输出的行为准；若都没有输出则退回最晚日期
    const outDates = dates.filter((x: any) => x.out);
    const pool = outDates.length ? outDates : dates;
    let max = pool[0];
    pool.forEach((x: any) => { if (key(x) > key(max)) max = x; });
    return `${min.y} 年 ${min.m} 月~${max.y} 年 ${max.m} 月`;
};

// 从时间线里找「产品开发计划」文件所在行的日期（取最早匹配行），格式「YYYY年M月D日」
const computeFileDate = (rows: any[], keyword = "产品开发计划"): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const matches = (rows || []).filter((r: any) =>
        (r.row_type || "date") === "date" && Object.values(r.cells || {}).some((v: any) => String(v || "").includes(keyword))
    );
    if (!matches.length) return "";
    const key = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    let best = matches[0];
    matches.forEach((r: any) => { if (key(r) < key(best)) best = r; });
    return `${num(best.year)}年${num(best.month)}月${num(best.day)}日`;
};

const ensureKeys = (nodes: any[]): any[] =>
    (nodes || []).map((n: any) => ({
        ...n,
        _key: n._key || genKey(),
        body: n.body ?? "",
        tables: Array.isArray(n.tables) ? n.tables : [],
        children: ensureKeys(n.children || []),
    }));

const stripKeys = (nodes: any[]): any[] =>
    (nodes || []).map(({ _key, ...rest }: any) => ({ ...rest, children: stripKeys(rest.children || []) }));

const findNode = (nodes: any[], key: string): any => {
    for (const n of nodes || []) {
        if (n._key === key) return n;
        const hit = findNode(n.children || [], key);
        if (hit) return hit;
    }
    return null;
};

const mapNode = (nodes: any[], key: string, fn: (n: any) => any): any[] =>
    (nodes || []).map((n: any) =>
        n._key === key ? fn(n) : { ...n, children: mapNode(n.children || [], key, fn) }
    );

const removeNode = (nodes: any[], key: string): any[] =>
    (nodes || []).filter((n: any) => n._key !== key).map((n: any) => ({ ...n, children: removeNode(n.children || [], key) }));

const firstKey = (nodes: any[]): string => (nodes && nodes[0] ? nodes[0]._key : "");

// 去掉标题里手写的数字前缀（如 "1.2 文档范围" -> "文档范围"），兼容旧数据
const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

// 按目录树结构自动计算编号：正文顶级 1/2/3，子级 1.1，孙级 1.1.1；封面/修订记录不编号
const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (n.ref_type === "cover" || n.ref_type === "revision") {
            map[n._key] = "";
            walkChildren(n.children || [], "", map);
            return;
        }
        bodyIdx += 1;
        map[n._key] = String(bodyIdx);
        walkChildren(n.children || [], String(bodyIdx), map);
    });
    return map;
};
const walkChildren = (nodes: any[], prefix: string, map: Record<string, string>) => {
    let idx = 0;
    (nodes || []).forEach((n: any) => {
        idx += 1;
        const num = prefix ? `${prefix}.${idx}` : `${idx}`;
        map[n._key] = num;
        walkChildren(n.children || [], num, map);
    });
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");

    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        pulling: false,
        doc: {} as any,
        sections: [] as any[],
        activeKey: "",
    });

    // 加载时按产品自动填充：产品简介=「产品名称：xxx」，产品概况=总体描述，产品开发周期=时间逻辑线最早~最晚
    const autoFillProduct = (nodes: any[], info: { name?: string; desc?: string; cycle?: string }): any[] => {
        const name = String(info.name || "").trim();
        const desc = String(info.desc || "").trim();
        const cycle = String(info.cycle || "").trim();
        const fix = (n: any): any => {
            let body = n.body;
            const isOverview = n.ref_type === "prod_overview"
                || (stripNum(n.title) === "产品概况" && (n.children || []).length === 0);
            const isCycle = n.ref_type === "prod_cycle"
                || (stripNum(n.title) === "产品开发周期" && (n.children || []).length === 0);
            if ((n.ref_type === "prod_name" || stripNum(n.title) === "产品简介") && name) {
                body = `产品名称：${name}`;
            } else if (isOverview && desc) {
                body = desc;
            } else if (isCycle && cycle) {
                body = cycle;
            }
            return { ...n, body, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 文件修订记录首行默认值：日期/版本/修订说明/修订人(产品经理)/批准人(产品部负责人)，仅填空格不覆盖已填
    const fillRevision = (nodes: any[], info: { fileDate?: string; version?: string; pm?: string; approver?: string }): any[] => {
        const fix = (n: any): any => {
            const isRev = n.ref_type === "revision" || stripNum(n.title) === "文件修订记录";
            let tables = n.tables;
            if (isRev && Array.isArray(n.tables) && Array.isArray(n.tables[0])) {
                const t = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const cols = (t[0] || []).length || 5;
                while (t.length < 6) t.push(new Array(cols).fill(""));
                const row = t[1];
                const setIf = (i: number, val: any) => { if (val && !String(row[i] || "").trim()) row[i] = val; };
                setIf(0, info.fileDate);
                setIf(1, info.version);
                if (!String(row[2] || "").trim()) row[2] = "首次发布";
                setIf(3, info.pm);
                setIf(4, info.approver);
                tables = [t, ...n.tables.slice(1)];
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_pdp_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const sections = ensureKeys((doc.content && doc.content.sections) || []);
            const finish = (secs: any[]) => dispatch({ loading: false, doc, sections: secs, activeKey: firstKey(secs) });
            if (!doc.product_id) {
                finish(sections);
                return;
            }
            Promise.all([
                ApiProduct.get_product({ id: doc.product_id }).catch(() => null),
                ApiTimeline.list_timeline({ prod_id: doc.product_id }).catch(() => null),
                ApiMember.list_project_member({ prod_id: doc.product_id, page_index: 0, page_size: 1000 }).catch(() => null),
            ]).then(([pr, tl, mb]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const findRole = (pred: (role: string) => boolean) => {
                    const hit = members.find((m: any) => pred(String(m.role || "")));
                    return hit ? String(hit.name || "").trim() : "";
                };
                let secs = autoFillProduct(sections, {
                    name: prod.name,
                    desc: prod.overall_desc,
                    cycle: computeCycle(tlRows),
                });
                secs = fillRevision(secs, {
                    fileDate: computeFileDate(tlRows),
                    version: doc.version,
                    pm: findRole((r) => r.includes("产品经理")),
                    approver: findRole((r) => r.includes("负责人") && r.includes("产品")),
                });
                finish(secs);
            }).catch(() => finish(sections));
        });
    };

    useEffect(() => {
        load();
    }, [id, location.pathname]);

    const setSections = (sections: any[]) => dispatch({ sections });
    const patchNode = (key: string, patch: any) =>
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, ...patch })));

    const addChild = (key: string) => {
        const child = { _key: genKey(), title: "新章节", body: "", tables: [], children: [] };
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, children: [...(n.children || []), child] })));
        dispatch({ activeKey: child._key });
    };
    const addRoot = () => {
        const node = { _key: genKey(), title: "新章节", body: "", tables: [], children: [] };
        const sections = [...data.sections, node];
        dispatch({ sections, activeKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.sections, key);
        dispatch({ sections, activeKey: data.activeKey === key ? firstKey(sections) : data.activeKey });
    };

    // ---- 当前章节的表格操作 ----
    const active = findNode(data.sections, data.activeKey);
    const updateTables = (tables: any[]) => patchNode(data.activeKey, { tables });
    const setCell = (ti: number, r: number, ci: number, val: string) => {
        const tables = (active.tables || []).map((tb: any[], i: number) =>
            i !== ti ? tb : tb.map((row: any[], ri: number) =>
                ri !== r ? row : row.map((cell: any, cc: number) => (cc === ci ? val : cell))
            )
        );
        updateTables(tables);
    };
    const addRow = (ti: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const cols = tb[0] ? tb[0].length : 1;
            return [...tb, new Array(cols).fill("")];
        });
        updateTables(tables);
    };
    const delRow = (ti: number, r: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => (i !== ti ? tb : tb.filter((_: any, ri: number) => ri !== r)));
        updateTables(tables);
    };
    const addCol = (ti: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => (i !== ti ? tb : tb.map((row: any[]) => [...row, ""])));
        updateTables(tables);
    };
    const delCol = (ti: number, ci: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => (i !== ti ? tb : tb.map((row: any[]) => row.filter((_: any, cc: number) => cc !== ci))));
        updateTables(tables);
    };
    const addTable = () => updateTables([...(active.tables || []), [["", ""], ["", ""]]]);
    const delTable = (ti: number) => updateTables((active.tables || []).filter((_: any, i: number) => i !== ti));

    // 从「产品参与人员」按当前产品拉取：默认标准表保持不变，只追加表中尚无对应角色（职责）的人
    const pullPersonnel = () => {
        const prodId = data.doc.product_id;
        if (!prodId) {
            message.warning("缺少产品信息，无法获取");
            return;
        }
        dispatch({ pulling: true });
        ApiMember.list_project_member({ prod_id: prodId, page_index: 0, page_size: 1000 }).then((res: any) => {
            dispatch({ pulling: false });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "获取失败");
                return;
            }
            const rows = (res.data && res.data.rows) || [];
            if (!rows.length) {
                message.info("该产品在「产品参与人员」中暂无数据");
                return;
            }
            const DEFAULT_HEADER = ["人数", "所属部门", "人员编制", "角色/岗位", "职责"];
            const cur = Array.isArray(active.tables?.[0]) ? active.tables[0] : [DEFAULT_HEADER];
            const header = Array.isArray(cur[0]) && cur[0].length === 5 ? cur[0] : DEFAULT_HEADER;
            const bodyRows = cur.slice(1).map((r: any[]) => Array.isArray(r) ? [...r] : r);
            const norm = (s: any) => String(s || "").trim();
            const roleMatch = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

            const used = new Array(rows.length).fill(false);
            let hit = 0;
            // 只同步表里已有角色：姓名+人数按参与人员实际更新，保留模板职责/部门；其余角色不获取
            bodyRows.forEach((row: any[]) => {
                const rowRole = norm(row[3]);
                if (!rowRole) return;
                const matched = rows.filter((m: any, i: number) => {
                    if (used[i]) return false;
                    const ok = roleMatch(resolveRole(m.role), rowRole);
                    if (ok) used[i] = true;
                    return ok;
                });
                if (matched.length) {
                    row[2] = matched.map((m: any) => norm(m.name)).filter(Boolean).join("、");
                    row[0] = String(matched.length);
                    hit += matched.length;
                }
            });

            if (!hit) {
                message.info("产品参与人员中没有与本表已有角色匹配的人");
                return;
            }
            updateTables([[header, ...bodyRows]]);
            message.success(`已按已有角色同步 ${hit} 人`);
        }).catch(() => {
            dispatch({ pulling: false });
            message.error("获取失败");
        });
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_pdp_doc({ id, content }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_pdp_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const numbers = computeNumbers(data.sections);

    const renderNav = (nodes: any[], depth: number) =>
        (nodes || []).map((n: any) => {
            const num = numbers[n._key];
            const label = `${num ? num + " " : ""}${stripNum(n.title) || "(未命名)"}`;
            return (
            <div key={n._key}>
                <div
                    className={`pdp-nav-item${n._key === data.activeKey ? " active" : ""}`}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => dispatch({ activeKey: n._key })}>
                    <span className="pdp-nav-title" title={label}>{label}</span>
                    {!readonly && (
                        <span className="pdp-nav-ops" onClick={(e) => e.stopPropagation()}>
                            <PlusOutlined title="添加子章节" onClick={() => addChild(n._key)} />
                            <DeleteOutlined title="删除章节" onClick={() => delNode(n._key)} />
                        </span>
                    )}
                </div>
                {renderNav(n.children || [], depth + 1)}
            </div>
            );
        });

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    产品开发计划
                    <span className="pdp-meta">
                        {data.doc.product_name ? `　${data.doc.product_name}` : ""}
                        {data.doc.product_full_version ? ` / ${data.doc.product_full_version}` : ""}
                        {data.doc.version ? `　文档版本：${data.doc.version}` : ""}
                    </span>
                </div>
                <Space>
                    {!readonly && (
                        <Button type="primary" loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    )}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/pdp_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">点章节改名/编辑，右侧 + 加子章节、🗑 删除；编号按层级自动生成</div>
                        )}
                        {renderNav(data.sections, 0)}
                        {!readonly && (
                            <Button className="pdp-nav-add" type="dashed" size="small" icon={<PlusOutlined />} onClick={addRoot}>
                                顶级章节
                            </Button>
                        )}
                    </div>

                    <div className="pdp-editor">
                        {!active ? (
                            <div className="pdp-empty">请选择或新增左侧章节</div>
                        ) : (
                            <>
                                <div className="pdp-field">
                                    <div className="pdp-label">章节标题{numbers[active._key] ? `（编号 ${numbers[active._key]} 自动生成）` : ""}</div>
                                    <Input
                                        addonBefore={numbers[active._key] || undefined}
                                        value={stripNum(active.title)}
                                        disabled={readonly}
                                        placeholder="只填名称，如：培训计划"
                                        onChange={(e) => patchNode(active._key, { title: e.target.value })}
                                    />
                                </div>
                                <div className="pdp-field">
                                    <div className="pdp-label">正文</div>
                                    <Input.TextArea
                                        autoSize={{ minRows: 3, maxRows: 20 }}
                                        value={active.body ?? ""}
                                        disabled={readonly}
                                        placeholder="本章节正文内容，可多行"
                                        onChange={(e) => patchNode(active._key, { body: e.target.value })}
                                    />
                                </div>

                                {(active.ref_type === "personnel" || stripNum(active.title) === "人员资源") && !readonly && (
                                    <div className="pdp-pull-bar">
                                        <Button type="primary" ghost loading={data.pulling} onClick={pullPersonnel}>
                                            从产品参与人员获取
                                        </Button>
                                        <span className="pdp-pull-hint">
                                            按当前产品{data.doc.product_full_version ? `（${data.doc.product_full_version}）` : ""}从「产品参与人员」同步：仅更新本表已有角色的姓名/人数（保留职责），表中没有的角色不获取
                                        </span>
                                    </div>
                                )}

                                {(active.tables || []).map((tb: any[], ti: number) => (
                                    <div className="pdp-table-block" key={ti}>
                                        <div className="pdp-table-bar">
                                            <span className="pdp-label">表格 {ti + 1}</span>
                                            {!readonly && (
                                                <Space size={4}>
                                                    <Button size="small" onClick={() => addRow(ti)}>＋行</Button>
                                                    <Button size="small" onClick={() => addCol(ti)}>＋列</Button>
                                                    <Button size="small" danger onClick={() => delTable(ti)}>删除此表</Button>
                                                </Space>
                                            )}
                                        </div>
                                        <table className="pdp-grid">
                                            <tbody>
                                                {tb.map((row: any[], r: number) => (
                                                    <tr key={r}>
                                                        {row.map((cell: any, ci: number) => (
                                                            <td key={ci} className={r === 0 ? "head" : ""}>
                                                                <Input.TextArea
                                                                    className="pdp-cell"
                                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                                    value={cell ?? ""}
                                                                    disabled={readonly}
                                                                    onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                />
                                                                {!readonly && r === 0 && tb[0].length > 1 && (
                                                                    <DeleteOutlined className="pdp-col-del" title="删除该列" onClick={() => delCol(ti, ci)} />
                                                                )}
                                                            </td>
                                                        ))}
                                                        {!readonly && (
                                                            <td className="pdp-row-op">
                                                                {tb.length > 1 && (
                                                                    <DeleteOutlined title="删除该行" onClick={() => delRow(ti, r)} />
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}

                                {!readonly && (
                                    <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addTable}>
                                        添加表格
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
