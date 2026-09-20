import { Button, Table, message, Row, Col, Space, Input, AutoComplete, Modal, Upload } from "antd";
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

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [],
        loading: false,
        fuzzy: "",
        targetEdit: {},
        editingField: null,
        updating: false,
        importing: false,
    });

    const loadHospitals = (fuzzy = "", allowSeed = true) => {
        dispatch({ loading: true });
        Api.list_prod_hospital({ fuzzy: fuzzy || undefined, page_index: 0, page_size: 5000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
                return;
            }
            const rows = res.data.rows || [];
            if (allowSeed && !String(fuzzy || "").trim() && !rows.length && DEFAULT_HOSPITALS.length) {
                const jobs = DEFAULT_HOSPITALS.map((h, i) =>
                    Api.add_prod_hospital({ prod_id: 0, ...h, sort_order: i + 1 })
                );
                Promise.all(jobs).then(() => loadHospitals("", false)).catch(() => {
                    dispatch({ loading: false, rows });
                });
                return;
            }
            dispatch({ loading: false, rows });
        });
    };

    const doAdd = () => {
        const maxSort = (data.rows || []).reduce((m: number, r: any) => Math.max(m, r.sort_order || 0), 0);
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
                loadHospitals(data.fuzzy, false);
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
                            loadHospitals(data.fuzzy, false);
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
                        loadHospitals(data.fuzzy, false);
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
        loadHospitals("", true);
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Row gutter={10} className="expand">
                    <Col>
                        <Input.Search
                            allowClear
                            placeholder="医院名称 / 医院编号 / 省份 / 城市"
                            style={{ width: 280 }}
                            value={data.fuzzy}
                            onChange={(e) => dispatch({ fuzzy: e.target.value })}
                            onSearch={(v) => loadHospitals(v, true)}
                        />
                    </Col>
                </Row>
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
