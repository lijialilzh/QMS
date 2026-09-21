import { Button, Table, message, Row, Col, Space, Input, AutoComplete, Modal, Upload, Form, Select } from "antd";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiProdHospital";

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

const queryParams = (query: any = {}) => {
    const pick = (...keys: string[]) => {
        for (const key of keys) {
            const text = String(query?.[key] || "").trim();
            if (text) return text;
        }
        return undefined;
    };
    return {
        org_name: pick("q_org", "org_name"),
        hospital_no: pick("q_no", "hospital_no"),
        province: pick("q_prov", "province"),
        city: pick("q_area", "city"),
    };
};

const uniqOptions = (rows: any[], key: string) => {
    const seen = new Set<string>();
    const out: { label: string; value: string }[] = [];
    (rows || []).forEach((row) => {
        const value = String(row?.[key] || "").trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        out.push({ label: value, value });
    });
    return out.sort((a, b) => a.value.localeCompare(b.value, "zh-CN"));
};

const filterRows = (rows: any[], query: any = {}) => {
    const q = queryParams(query);
    return (rows || []).filter((row) => {
        if (q.org_name && !String(row.org_name || "").includes(q.org_name)) return false;
        if (q.hospital_no && !String(row.hospital_no || "").toUpperCase().includes(q.hospital_no.toUpperCase())) return false;
        if (q.province && String(row.province || "").trim() !== q.province) return false;
        if (q.city && String(row.city || "").trim() !== q.city) return false;
        return true;
    });
};

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        allRows: [],
        rows: [],
        loading: false,
        targetEdit: {},
        editingField: null,
        updating: false,
        importing: false,
    });

    const applyQuery = (query: any = queryForm.getFieldsValue(), allRows = data.allRows) => {
        const next = { ...query };
        const province = String(next.q_prov || next.province || "").trim();
        const city = String(next.q_area || next.city || "").trim();
        if (province && city) {
            const cities = uniqOptions(
                (allRows || []).filter((row: any) => String(row.province || "").trim() === province),
                "city"
            ).map((item) => item.value);
            if (!cities.includes(city)) {
                next.q_area = undefined;
                next.city = undefined;
                queryForm.setFieldsValue({ q_area: undefined });
            }
        }
        dispatch({ rows: filterRows(allRows, next) });
    };

    const loadHospitals = (allowSeed = true) => {
        dispatch({ loading: true });
        Api.list_prod_hospital({ page_index: 0, page_size: 5000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, allRows: [], rows: [] });
                message.error(res.msg);
                return;
            }
            const allRows = res.data.rows || [];
            if (allowSeed && !allRows.length && DEFAULT_HOSPITALS.length) {
                const jobs = DEFAULT_HOSPITALS.map((h, i) =>
                    Api.add_prod_hospital({ prod_id: 0, ...h, sort_order: i + 1 })
                );
                Promise.all(jobs).then(() => loadHospitals(false)).catch(() => {
                    dispatch({ loading: false, allRows, rows: allRows });
                });
                return;
            }
            dispatch({ loading: false, allRows, rows: filterRows(allRows, queryForm.getFieldsValue()) });
        });
    };

    const reload = () => loadHospitals(false);

    const doAdd = () => {
        const maxSort = (data.allRows || data.rows || []).reduce((m: number, r: any) => Math.max(m, r.sort_order || 0), 0);
        Api.add_prod_hospital({
            prod_id: 0,
            contract_no: "",
            org_name: "",
            hospital_no: "",
            region: "",
            province: "",
            city: "",
            sort_order: maxSort + 1,
        }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg || ts("msg_ok"));
                reload();
            } else {
                message.error(res.msg);
            }
        });
    };

    const doImport = (file: any) => {
        Modal.confirm({
            title: "导入合规医院列表",
            content: "导入将覆盖当前全部医院，确认导入？",
            onOk: () => {
                dispatch({ importing: true });
                Api.import_prod_hospitals({ prod_id: 0, replace: true, file: { fileList: [file] } }).then(
                    (res: any) => {
                        dispatch({ importing: false });
                        if (res.code === Api.C_OK) {
                            message.success(`导入成功，共 ${res.data?.imported ?? 0} 家`);
                            reload();
                        } else {
                            message.error(res.msg);
                        }
                    }
                );
            },
        });
        return false;
    };

    const doDelete = (row: any) => {
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            onOk: () => {
                Api.delete_prod_hospitals({ id: row.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success(res.msg);
                        reload();
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
                const allRows = (data.allRows || []).map((r: any) => (r.id === edit.id ? { ...r, ...edit } : r));
                dispatch({ updating: false, targetEdit: {}, editingField: null, allRows, rows: filterRows(allRows, queryForm.getFieldsValue()) });
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
        textCol("医院名称", "org_name"),
        {
            title: "区域划分",
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
        textCol("医院编号", "hospital_no", "14%"),
        textCol("省份", "province", "12%"),
        textCol("城市信息", "city", "14%"),
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
        loadHospitals(true);
    }, []);

    const selectedProvince = String(Form.useWatch("q_prov", queryForm) || "").trim();
    const provinceOptions = uniqOptions(data.allRows, "province");
    const cityOptions = uniqOptions(
        selectedProvince
            ? (data.allRows || []).filter((row: any) => String(row.province || "").trim() === selectedProvince)
            : data.allRows,
        "city"
    );

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    autoComplete="off"
                    onValuesChange={(_changed, values) => applyQuery(values)}
                    onFinish={(values) => applyQuery(values)}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label="医院名称" name="q_org">
                                <Input allowClear autoComplete="off" style={{ width: 180 }} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label="医院编号" name="q_no">
                                <Input allowClear autoComplete="off" style={{ width: 140 }} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label="省份" name="q_prov">
                                <Select
                                    allowClear
                                    placeholder="请选择"
                                    options={provinceOptions}
                                    autoComplete="off"
                                    style={{ width: 140 }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label="城市" name="q_area">
                                <Select
                                    allowClear
                                    placeholder="请选择"
                                    options={cityOptions}
                                    autoComplete="off"
                                    style={{ width: 140 }}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
                <div className="div-h hspace">
                    <Upload showUploadList={false} accept=".xls,.xlsx" beforeUpload={doImport}>
                        <Button type="primary" loading={data.importing}>
                            导入
                        </Button>
                    </Upload>
                    <Button onClick={doAdd}>
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
