import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiSdsTrace";
import * as ApiDoc from "@/api/ApiSdsDoc";
import * as ApiSdsReqd from "@/api/ApiSdsReqd";
import { doSearchProducts } from "../prod_risk/util";

const pageSizeOptions = [100, 500, 1000];

const splitTraceLines = (value?: string) => {
    const lines = String(value || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim());
    while (lines.length > 1 && !lines[lines.length - 1]) {
        lines.pop();
    }
    return lines.length > 0 ? lines : [""];
};

const normalizeSdsCode = (value?: string) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const parseHeadingNumber = (value?: string) => String(value || "").trim().match(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/)?.[1] || "";
const stripHeadingNumber = (value?: string) => String(value || "").trim().replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "").trim();
const normalizeReqTitle = (value?: string) => {
    const raw = String(value || "").trim();
    const stripped = stripHeadingNumber(raw);
    return (stripped || raw).replace(/\s+/g, "").toLowerCase();
};
const isEmptyLocation = (value?: string) => {
    const txt = String(value || "").trim();
    return !txt || txt === "-" || txt === "—";
};
const collectEmptyLocationSdsCodes = (rows: any[]) => {
    const targetCodes = new Set<string>();
    (rows || []).forEach((row: any) => {
        const sdsCodes = splitTraceLines(row?.sds_code);
        for (let index = 0; index < sdsCodes.length; index += 1) {
            const code = normalizeSdsCode(sdsCodes[index]);
            if (code) {
                targetCodes.add(code);
            }
        }
    });
    return targetCodes;
};
const incrementHeading = (heading: string, offset = 1) => {
    const parts = String(heading || "").split(".").map((part) => Number(part));
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return "";
    parts[parts.length - 1] += offset;
    return parts.join(".");
};
const codeNumbers = (code?: string) => normalizeSdsCode(code).match(/\d+/g)?.map(Number) || [];
const codeMajor = (code?: string) => codeNumbers(code)[0] || 0;
const compareReqCode = (a?: string, b?: string) => {
    const ax = codeNumbers(a);
    const bx = codeNumbers(b);
    const len = Math.max(ax.length, bx.length);
    for (let i = 0; i < len; i += 1) {
        const diff = (ax[i] || 0) - (bx[i] || 0);
        if (diff !== 0) return diff;
    }
    return normalizeSdsCode(a).localeCompare(normalizeSdsCode(b));
};
const isFunctionChapterStopper = (title?: string) => {
    const text = normalizeReqTitle(title);
    return text.includes("限制条件") || text.includes("尚未解决的问题");
};
const buildSdsLocationMapFromDoc = (content: any[]) => {
    const map = new Map<string, string>();
    const anchors: Array<{ code: string; headings: string[] }> = [];
    const titlePathMap = new Map<string, string>();
    let functionAreaBaseHeading = "";
    let functionAreaInsertHeading = "";
    const walk = (nodes: any[], headings: string[] = [], titlePath: string[] = []) => {
        (nodes || []).forEach((node) => {
            const code = normalizeSdsCode(node?.sds_code);
            const heading = parseHeadingNumber(node?.title);
            const titleKey = normalizeReqTitle(node?.title);
            const nextHeadings = heading ? [...headings, heading] : headings;
            const nextTitlePath = titleKey ? [...titlePath, titleKey] : titlePath;
            if (heading && nextTitlePath.length) {
                nextTitlePath.forEach((_title, index) => {
                    titlePathMap.set(nextTitlePath.slice(index).join("/"), heading);
                });
            }
            if (code && heading && !map.has(code)) {
                map.set(code, heading);
            } else if (code && nextHeadings.length && !map.has(code)) {
                map.set(code, nextHeadings[nextHeadings.length - 1]);
            }
            if (code && nextHeadings.length) {
                anchors.push({ code, headings: nextHeadings });
            }
            if (heading === "6" || normalizeReqTitle(node?.title).includes("功能设计")) {
                const childInfos = (node?.children || [])
                    .map((child: any) => ({ title: child?.title, heading: parseHeadingNumber(child?.title) }))
                    .filter((child: any) => child.heading);
                const firstStopper = childInfos.find((child: any) => isFunctionChapterStopper(child.title));
                const childHeadings = childInfos
                    .filter((child: any) => !isFunctionChapterStopper(child.title))
                    .map((child: any) => child.heading);
                if (firstStopper?.heading) {
                    functionAreaInsertHeading = firstStopper.heading;
                }
                if (childHeadings.length) {
                    functionAreaBaseHeading = childHeadings[childHeadings.length - 1];
                } else if (heading) {
                    functionAreaBaseHeading = `${heading}.0`;
                }
            }
            walk(node?.children || [], nextHeadings, nextTitlePath);
        });
    };
    walk(content || []);
    return { map, anchors, titlePathMap, functionAreaBaseHeading, functionAreaInsertHeading };
};
const getReqHierarchyTitles = (row: any) => {
    const titles = [row?.module, row?.function, row?.sub_function]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    const uniqueTitles: string[] = [];
    titles.forEach((title) => {
        if (!uniqueTitles.some((item) => normalizeReqTitle(item) === normalizeReqTitle(title))) {
            uniqueTitles.push(title);
        }
    });
    return uniqueTitles.length ? uniqueTitles : [String(row?.name || row?.srs_code || "").trim()].filter(Boolean);
};
const addVirtualHierarchyRow = (nodes: any[], row: any, code: string) => {
    let levelNodes = nodes;
    getReqHierarchyTitles(row).forEach((title, index, titles) => {
        const isLeaf = index === titles.length - 1;
        let target = levelNodes.find((node) => normalizeReqTitle(node.title) === normalizeReqTitle(title));
        if (!target) {
            target = { title, children: [], ...(isLeaf ? { sds_code: code } : {}) };
            levelNodes.push(target);
        } else if (isLeaf && !target.sds_code) {
            target.sds_code = code;
        }
        levelNodes = target.children;
    });
};
const assignVirtualLocationsWithExistingTitles = (
    nodes: any[],
    parentHeading: string,
    map: Map<string, string>,
    titlePathMap: Map<string, string>,
    titlePath: string[] = [],
    startIndex = 1
) => {
    nodes.forEach((node, index) => {
        const nextTitlePath = [...titlePath, normalizeReqTitle(node.title)].filter(Boolean);
        const existingHeading = titlePathMap.get(nextTitlePath.join("/"));
        const heading = existingHeading || `${parentHeading}.${startIndex + index}`;
        const code = normalizeSdsCode(node.sds_code);
        if (code && !map.has(code)) {
            map.set(code, heading);
        }
        assignVirtualLocationsWithExistingTitles(node.children || [], heading, map, titlePathMap, nextTitlePath);
    });
};
const buildVirtualLocationMap = (
    reqdRows: any[],
    savedLocationMap: Map<string, string>,
    anchors: Array<{ code: string; headings: string[] }>,
    functionAreaBaseHeading = "",
    targetCodes = new Set<string>(),
    titlePathMap = new Map<string, string>(),
    functionAreaInsertHeading = ""
) => {
    const savedMap = new Map(savedLocationMap);
    const maxExistingMajor = anchors.length ? Math.max(...anchors.map((anchor) => codeMajor(anchor.code))) : 0;
    const missingRows = (reqdRows || [])
        .map((row) => ({ row, code: normalizeSdsCode(String(row?.srs_code || "").replace(/^SRS-/i, "SDS-")) }))
        .filter(({ row, code }) => {
            const typeCode = String(row?.type_code || "").trim();
            return code
                && typeCode !== "1"
                && typeCode !== "2"
                && targetCodes.has(code)
                && !savedMap.has(code)
                && (!maxExistingMajor || codeMajor(code) >= maxExistingMajor);
        })
        .sort((a, b) => compareReqCode(a.code, b.code));
    if (!missingRows.length) return savedMap;

    const nearest = anchors
        .filter((anchor) => compareReqCode(anchor.code, missingRows[0].code) < 0)
        .sort((a, b) => compareReqCode(b.code, a.code))[0] || anchors[anchors.length - 1];
    const nearestHeading = nearest?.headings?.[Math.max(0, nearest.headings.length - 2)] || nearest?.headings?.[nearest.headings.length - 1] || "";
    const anchorHeading = functionAreaBaseHeading || nearestHeading;
    const firstVirtualHeading = functionAreaInsertHeading || incrementHeading(anchorHeading);
    if (!firstVirtualHeading) return savedMap;

    const virtualRoots: any[] = [];
    missingRows.forEach(({ row, code }) => addVirtualHierarchyRow(virtualRoots, row, code));
    const parentHeading = firstVirtualHeading.split(".").slice(0, -1).join(".");
    const startIndex = Number(firstVirtualHeading.split(".").slice(-1)[0]);
    virtualRoots.forEach((root, index) => {
        assignVirtualLocationsWithExistingTitles([root], parentHeading, savedMap, titlePathMap, [], startIndex + index);
    });
    return savedMap;
};

const expandTraceRows = (rows: any[], locationBySdsCode?: Map<string, string>) => {
    return (rows || []).flatMap((row: any, rowIndex: number) => {
        const sdsCodes = splitTraceLines(row.sds_code);
        const chapters = splitTraceLines(row.chapter);
        const locations = splitTraceLines(row.location);
        const count = Math.max(1, sdsCodes.length, chapters.length, locations.length);
        return Array.from({ length: count }).map((_, index) => ({
            ...row,
            key: `${row.id || row.key || rowIndex}_${index}`,
            sds_code: sdsCodes[index] ?? "",
            chapter: chapters[index] ?? "",
            location: locationBySdsCode?.get(normalizeSdsCode(sdsCodes[index])) || (locations[index] ?? ""),
            _sourceRow: row,
            _splitIndex: index,
            _rowSpan: index === 0 ? count : 0,
        }));
    });
};

const renderMergedCell = (children: any, row: any) => ({
    children,
    props: {
        rowSpan: row._rowSpan,
    },
});

enum DlgTypes {
    edit = "edit",
    delete = "delete",
}

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            Api.update_sds_trace(values).then((res: any) => {
                if (res.code === Api.C_OK) {
                    onSaved();
                    dispatch({ loading: false, dlgType: null });
                    message.success(res.msg);
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg);
                }
            });
        });
    };

    useEffect(() => {
        if (data.dlgType === DlgTypes.edit) {
            editForm.resetFields();
            dispatch({ files: [] });
            editForm.setFieldsValue(data.targetRow);
            // if (data.dlgType === DlgTypes.edit && data.targetRow.id) {
            //     dispatch({ loading: true });
            //     Api.get_sds_trace({ id: data.targetRow.id }).then((res: any) => {
            //         if (res.code === Api.C_OK) {
            //             const targetRow = res.data;
            //             editForm.setFieldsValue(targetRow);
            //             dispatch({ loading: false, targetRow });
            //         } else {
            //             message.error(res.msg);
            //             dispatch({ loading: false });
            //         }
            //     });
            // }
        }
    }, [data.dlgType, data.targetRow.id]);

    return (
        <Modal
            width={"50%"}
            centered
            title={ts("edit")}
            open={data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <div className="div-v">
                <Form form={editForm} className="expand" onFinish={(_values) => {}}>
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    <Form.Item hidden name="req_id">
                        <Input allowClear value={data.targetRow.req_id} />
                    </Form.Item>
                    <Form.Item hidden name="doc_id">
                        <Input allowClear value={data.targetRow.doc_id} />
                    </Form.Item>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_trace.srs_code")} name="srs_code">
                                <Input disabled allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("sds_trace.sds_code")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("sds_trace.sds_code") }) }]}
                                name="sds_code">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_trace.chapter")} name="chapter">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_trace.location")} name="location">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </div>
        </Modal>
    );
};

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        products: [],
        docs: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        if (!params?.prod_id || !params?.doc_id) {
            dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
            return;
        }
        dispatch({ loading: true });
        Promise.all([
            Api.list_sds_trace({ ...params, page_index: pageIndex - 1, page_size: pageSize }),
            ApiDoc.get_sds_doc({ id: params.doc_id }),
            ApiSdsReqd.list_sds_reqd({ doc_id: params.doc_id, page_index: 0, page_size: 10000, _ts: Date.now() }),
        ]).then(([res, docRes, reqdRes]: any[]) => {
            if (res.code === Api.C_OK) {
                const targetCodes = collectEmptyLocationSdsCodes(res.data.rows || []);
                const docLocationInfo = docRes?.code === ApiDoc.C_OK
                    ? buildSdsLocationMapFromDoc(docRes?.data?.content || [])
                    : {
                        map: new Map<string, string>(),
                        anchors: [],
                        titlePathMap: new Map<string, string>(),
                        functionAreaBaseHeading: "",
                        functionAreaInsertHeading: "",
                    };
                const locationBySdsCode = reqdRes?.code === ApiSdsReqd.C_OK
                    ? buildVirtualLocationMap(
                        reqdRes?.data?.rows || [],
                        docLocationInfo.map,
                        docLocationInfo.anchors,
                        docLocationInfo.functionAreaBaseHeading,
                        targetCodes,
                        docLocationInfo.titlePathMap,
                        docLocationInfo.functionAreaInsertHeading
                    )
                    : docLocationInfo.map;
                dispatch({
                    loading: false,
                    pageIndex,
                    pageSize,
                    total: res.data.total,
                    rows: expandTraceRows(res.data.rows || [], locationBySdsCode),
                });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        }).catch((error: any) => {
            console.error("加载设计与需求追溯失败:", error);
            dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
            message.error("加载设计与需求追溯失败");
        });
    };

    const doSearchDocs = (params: any) => {
        dispatch({ loadingDocs: true });
        ApiDoc.list_sds_doc({ ...params }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingDocs: false, docs: res.data.rows });
            } else {
                dispatch({ loadingDocs: false, docs: [] });
                message.error(res.msg);
            }
        });
    };

    const columns = [
        {
            title: ts("sds_trace.srs_code"),
            dataIndex: "srs_code",
            render: (t: string, row: any) => renderMergedCell(t || "-", row),
        },
        {
            title: ts("sds_trace.sds_code"),
            dataIndex: "sds_code",
            render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-",
        },
        {
            title: ts("sds_trace.type_name"),
            dataIndex: "type_name",
            render: (t: string, row: any) => renderMergedCell(t || "-", row),
        },
        {
            title: ts("sds_trace.chapter"),
            dataIndex: "chapter",
            render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-",
        },
        {
            title: ts("sds_trace.location"),
            dataIndex: "location",
            render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-",
        },
        {
            title: ts("sds_doc.version"),
            dataIndex: "sdsdoc_version",
            render: (t: string, row: any) => renderMergedCell(t || "-", row),
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return renderMergedCell(
                    <Space size={8} style={{ whiteSpace: "nowrap" }}>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row._sourceRow || row })}>
                            {ts("edit")}
                        </Button>
                    </Space>,
                    row
                );
            },
        },
    ];

    useEffect(() => {
        doSearchProducts(data, dispatch);
    }, []);

    return (
        <div className="page div-v sds-traces">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="prod_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        queryForm.setFieldValue("prod_id", value);
                                        dispatch({ docs: [], rows: [], total: 0, pageIndex: 1 });
                                        queryForm.setFieldsValue({ doc_id: null });
                                        doSearchDocs({ product_id: value });
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("sds_doc.version")} name="doc_id">
                                <Select allowClear options={data.docs.map((item: any) => ({ label: item.version, value: item.id }))} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
            </div>
            <Table
                className="expand"
                columns={columns}
                rowKey={(item: any) => item.key}
                dataSource={data.rows}
                loading={data.loading}
                bordered
                scroll={{ y: "68vh" }}
                pagination={{
                    total: data.total,
                    current: data.pageIndex,
                    showSizeChanger: true,
                    defaultPageSize: pageSizeOptions[0],
                    pageSizeOptions,
                    hideOnSinglePage: false,
                    onShowSizeChange: (page, pageSize) => {
                        dispatch({ pageIndex: page, pageSize: pageSize });
                    },
                    showTotal: (total: number) => {
                        return sprintf(ts("total_items"), { total });
                    },
                }}
                onChange={(pager, _, _sorter: any) => {
                    const form = queryForm.getFieldsValue();
                    doSearch(form, pager.current, pager.pageSize);
                }}
            />
            <DetailDlg
                data={data}
                dispatch={dispatch}
                onSaved={() => {
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
        </div>
    );
};
