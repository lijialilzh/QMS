import { Button, Table, message, Row, Col, Space, Input, AutoComplete, Modal } from "antd";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdHospital";
import * as ApiProduct from "@/api/ApiProduct";

const REGIONS = ["东区", "南区", "西区", "北区"];

const DEFAULT_HOSPITALS = [
    { contract_no: "TX-XS-KY-18060022", org_name: "华中科技大学同济医学院附属同济医院", hospital_no: "CE027001", region: "东区" },
    { contract_no: "TX-XS-KY-18060033", org_name: "大连大学附属中山医院", hospital_no: "CN411002", region: "北区" },
    { contract_no: "TX-XS-KY-19060044", org_name: "陕西省安康市中心医院", hospital_no: "CW915001", region: "西区" },
    { contract_no: "TX-XS-KY-19070088", org_name: "江苏大学附属医院", hospital_no: "CE511002", region: "东区" },
    { contract_no: "FW-JSFW20200082501012", org_name: "中国医学科学院北京协和医院", hospital_no: "CN010001", region: "北区" },
    { contract_no: "TX-XS-KY-19010011", org_name: "深圳市第三人民医院", hospital_no: "CS755002", region: "南区" },
    { contract_no: "TX-XS-KY-21090330", org_name: "中南大学湘雅二医院", hospital_no: "CS731001", region: "南区" },
    { contract_no: "TX-XS-KY-22010331", org_name: "福建医科大学附属协和医院", hospital_no: "CS591003", region: "南区" },
];

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [],
        loading: false,
        products: [],
        targetProdId: null,
        fuzzy: "",
        targetEdit: {},
        editingField: null,
        updating: false,
    });

    const loadProducts = () => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows || [] });
            }
        });
    };

    const loadHospitals = (prodId: any, fuzzy = "", allowSeed = true) => {
        if (!prodId) {
            dispatch({ rows: [] });
            return;
        }
        dispatch({ loading: true });
        Api.list_prod_hospital({ prod_id: prodId, fuzzy: fuzzy || undefined, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
                return;
            }
            const rows = res.data.rows || [];
            if (allowSeed && !String(fuzzy || "").trim() && !rows.length && DEFAULT_HOSPITALS.length) {
                const jobs = DEFAULT_HOSPITALS.map((h, i) =>
                    Api.add_prod_hospital({ prod_id: prodId, ...h, sort_order: i + 1 })
                );
                Promise.all(jobs).then(() => loadHospitals(prodId, "", false)).catch(() => {
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
        Api.add_prod_hospital({
            prod_id: data.targetProdId,
            contract_no: "",
            org_name: "",
            hospital_no: "",
            region: "",
            sort_order: maxSort + 1,
        }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg || ts("msg_ok"));
                loadHospitals(data.targetProdId, data.fuzzy, false);
            } else {
                message.error(res.msg);
            }
        });
    };

    const doDelete = (row: any) => {
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            onOk: () => {
                Api.delete_prod_hospitals({ id: row.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success(res.msg);
                        loadHospitals(data.targetProdId, data.fuzzy, false);
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const startEdit = (row: any, field: string) => {
        if (data.targetEdit.id === row.id && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
    };

    const saveCell = () => {
        const edit = { ...data.targetEdit };
        if (!edit?.id || data.updating) return;
        dispatch({ updating: true });
        Api.update_prod_hospital({ ...edit }).then((res: any) => {
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

    const textCol = (title: string, field: string, width?: string) => ({
        title,
        dataIndex: field,
        width,
        render: (value: any, row: any) => {
            if (!isEditing(row, field)) return clickToEdit(row, field, value);
            return (
                <Input
                    autoFocus
                    value={data.targetEdit[field]}
                    onChange={(e: any) => dispatch({ targetEdit: { ...data.targetEdit, [field]: e.target.value } })}
                    onBlur={() => saveCell()}
                    onPressEnter={() => saveCell()}
                />
            );
        },
    });

    const columns = [
        textCol("合同编号", "contract_no", "22%"),
        textCol("对方单位名称", "org_name"),
        textCol("医院编号", "hospital_no", "16%"),
        {
            title: "区域",
            dataIndex: "region",
            width: "12%",
            render: (value: any, row: any) => {
                if (!isEditing(row, "region")) return clickToEdit(row, "region", value);
                return (
                    <AutoComplete
                        autoFocus
                        defaultOpen
                        style={{ width: "100%" }}
                        value={data.targetEdit.region}
                        options={REGIONS.map((r) => ({ label: r, value: r }))}
                        filterOption={false}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, region: v } })}
                        onBlur={() => saveCell()}
                    />
                );
            },
        },
        {
            title: ts("action"),
            width: 90,
            render: (_value: any, row: any) => (
                <Space>
                    <Button type="link" danger onClick={() => doDelete(row)}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
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
                                        dispatch({ targetProdId: v ?? null, targetEdit: {}, editingField: null, fuzzy: "" });
                                        loadHospitals(v ?? null, "", true);
                                    }}
                                />
                            </div>
                            <Input.Search
                                allowClear
                                placeholder="合同编号 / 单位名称 / 医院编号"
                                style={{ width: 280 }}
                                disabled={!data.targetProdId}
                                value={data.fuzzy}
                                onChange={(e) => dispatch({ fuzzy: e.target.value })}
                                onSearch={(v) => loadHospitals(data.targetProdId, v, true)}
                            />
                        </Space>
                    </Col>
                </Row>
                <div className="div-h hspace">
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
