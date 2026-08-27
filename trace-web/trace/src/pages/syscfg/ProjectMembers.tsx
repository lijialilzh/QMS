import { Button, Table, message, Row, Col, Space, Input, AutoComplete, Modal, Upload } from "antd";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";

const ROLES = [
    "管理者代表",
    "研发负责人",
    "产品负责人",
    "RA",
    "QA",
    "TPM",
    "产品经理",
    "开发人员",
    "测试人员",
    "生产",
    "临床",
    "标注人员",
];

const ANNOTATOR_ROLE = "标注人员";
const DEFAULT_ANNOTATORS = [
    "刘冰",
    "周鑫仪",
    "蒙明",
    "余露",
    "王丽",
    "任小军",
    "赵钰淇",
    "龙菲",
    "李良梦",
    "徐飘飘",
    "史江坤",
    "马星宇",
    "王莹莹",
];

// 备注快捷标识：用于标注开发人员前后端及所属模块（仍可自由输入其它备注）
const NOTE_OPTIONS = ["前端-NeoViewer", "后端-Repacs", "后端-Dlserver", "后端-DP"];

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [],
        loading: false,
        products: [],
        targetProdId: null,
        targetEdit: {},
        editingField: null,
        updating: false,
        importing: false,
    });

    const loadProducts = () => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows || [] });
            }
        });
    };

    const loadMembers = (prodId: any, allowSeed = true) => {
        if (!prodId) {
            dispatch({ rows: [] });
            return;
        }
        dispatch({ loading: true });
        Api.list_project_member({ prod_id: prodId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
                return;
            }
            const rows = res.data.rows || [];
            const hasAnnotator = rows.some((r: any) => (r.role || "").trim() === ANNOTATOR_ROLE);
            if (allowSeed && !hasAnnotator && DEFAULT_ANNOTATORS.length) {
                const maxSort = rows.reduce((m: number, r: any) => Math.max(m, r.sort_order || 0), 0);
                Promise.all(
                    DEFAULT_ANNOTATORS.map((name, i) =>
                        Api.add_project_member({
                            prod_id: prodId,
                            role: ANNOTATOR_ROLE,
                            name,
                            sort_order: maxSort + 1 + i,
                        })
                    )
                ).then(() => loadMembers(prodId, false)).catch(() => {
                    dispatch({ loading: false, rows });
                });
                return;
            }
            dispatch({ loading: false, rows });
        });
    };

    const doAdd = () => {
        if (!data.targetProdId) {
            message.warning("请先选择产品");
            return;
        }
        const maxSort = (data.rows || []).reduce((m: number, r: any) => Math.max(m, r.sort_order || 0), 0);
        Api.add_project_member({ prod_id: data.targetProdId, role: ROLES[0], name: "", sort_order: maxSort + 1 }).then(
            (res: any) => {
                if (res.code === Api.C_OK) {
                    message.success(res.msg || ts("msg_ok"));
                    loadMembers(data.targetProdId);
                } else {
                    message.error(res.msg);
                }
            }
        );
    };

    const doDelete = (row: any) => {
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            onOk: () => {
                Api.delete_project_members({ id: row.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success(res.msg);
                        loadMembers(data.targetProdId);
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const doImport = (file: any) => {
        if (!data.targetProdId) {
            message.warning("请先选择产品");
            return false;
        }
        Modal.confirm({
            title: "导入项目人员清单",
            content: "导入将覆盖当前产品已有的人员，确认导入？",
            onOk: () => {
                dispatch({ importing: true });
                Api.import_project_members({ prod_id: data.targetProdId, replace: true, file: { fileList: [file] } }).then(
                    (res: any) => {
                        dispatch({ importing: false });
                        if (res.code === Api.C_OK) {
                            message.success(`导入成功，共 ${res.data?.imported ?? 0} 人`);
                            loadMembers(data.targetProdId);
                        } else {
                            message.error(res.msg);
                        }
                    }
                );
            },
        });
        return false;
    };

    const startEdit = (row: any, field: string) => {
        if (data.targetEdit.id === row.id && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
    };

    const saveCell = (override?: any) => {
        const edit = { ...data.targetEdit, ...(override || {}) };
        if (!edit?.id || data.updating) return;
        dispatch({ updating: true });
        Api.update_project_member({ ...edit }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((r: any) => (r.id === edit.id ? { ...r, ...edit } : r));
                dispatch({ updating: false, targetEdit: {}, editingField: null, rows });
                message.success(res.msg || ts("msg_ok"));
            } else {
                dispatch({ updating: false });
                message.error(res.msg);
            }
        });
    };

    const isEditing = (row: any, field: string) => data.targetEdit.id === row.id && data.editingField === field;

    const clickToEdit = (row: any, field: string, value: any) => (
        <div style={{ cursor: "pointer", minHeight: 22 }} title="点击编辑" onClick={() => startEdit(row, field)}>
            {value !== null && value !== undefined && String(value) !== "" ? value : <span style={{ color: "#d9d9d9" }}>—</span>}
        </div>
    );

    const columns = [
        {
            title: "职能",
            dataIndex: "role",
            width: "30%",
            render: (value: any, row: any) => {
                if (!isEditing(row, "role")) return clickToEdit(row, "role", value);
                return (
                    <AutoComplete
                        autoFocus
                        defaultOpen
                        style={{ width: "100%" }}
                        value={data.targetEdit.role}
                        options={ROLES.map((r) => ({ label: r, value: r }))}
                        filterOption={false}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, role: v } })}
                        onBlur={() => saveCell()}
                    />
                );
            },
        },
        {
            title: "姓名",
            dataIndex: "name",
            width: "30%",
            render: (value: any, row: any) => {
                if (!isEditing(row, "name")) return clickToEdit(row, "name", value);
                return (
                    <Input
                        autoFocus
                        value={data.targetEdit.name}
                        onChange={(e: any) => dispatch({ targetEdit: { ...data.targetEdit, name: e.target.value } })}
                        onBlur={() => saveCell()}
                        onPressEnter={() => saveCell()}
                    />
                );
            },
        },
        {
            title: ts("project.note"),
            dataIndex: "note",
            render: (value: any, row: any) => {
                if (!isEditing(row, "note")) return clickToEdit(row, "note", value);
                return (
                    <AutoComplete
                        autoFocus
                        defaultOpen
                        style={{ width: "100%" }}
                        value={data.targetEdit.note}
                        options={NOTE_OPTIONS.map((r) => ({ label: r, value: r }))}
                        filterOption={false}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, note: v } })}
                        onBlur={() => saveCell()}
                    />
                );
            },
        },
        {
            title: ts("action"),
            width: 90,
            render: (_value: any, row: any) => {
                return (
                    <Space>
                        <Button type="link" danger onClick={() => doDelete(row)}>
                            {ts("delete")}
                        </Button>
                    </Space>
                );
            },
        },
    ];

    useEffect(() => {
        loadProducts();
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Row gutter={10} className="expand">
                    <Col>
                        <Space>
                            <span>{ts("srs_doc.select_product")}：</span>
                            <div style={{ minWidth: 360 }}>
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    value={data.targetProdId}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.version")}
                                    onChange={(v: any) => {
                                        dispatch({ targetProdId: v ?? null, targetEdit: {}, editingField: null });
                                        loadMembers(v ?? null);
                                    }}
                                />
                            </div>
                        </Space>
                    </Col>
                </Row>
                <div className="div-h hspace">
                    <Upload showUploadList={false} accept=".xlsx" beforeUpload={doImport}>
                        <Button type="primary" disabled={!data.targetProdId} loading={data.importing}>
                            导入清单
                        </Button>
                    </Upload>
                    <Button disabled={!data.targetProdId} onClick={doAdd}>
                        {ts("add")}
                    </Button>
                </div>
            </div>
            <Table
                className="expand"
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                pagination={false}
                footer={() => sprintf(ts("total_items"), { total: (data.rows || []).length })}
            />
        </div>
    );
};
