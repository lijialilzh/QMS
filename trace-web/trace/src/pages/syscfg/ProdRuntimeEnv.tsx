import { message, Space, Input, Spin } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdRuntimeEnv";
import * as ApiProduct from "@/api/ApiProduct";
import "./ProdRuntimeEnv.less";

const FIELDS = [
    "arch",
    "srv_cpu", "srv_memory", "srv_gpu", "srv_disk", "srv_nic",
    "srv_os", "srv_cuda",
    "cli_cpu", "cli_memory", "cli_resolution", "cli_os", "cli_browser",
    "net_lan", "net_wan",
];

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        products: [],
        prodId: null,
        form: {} as any,
        snapshot: {} as any,
        loading: false,
        saving: false,
    });

    const loadProducts = () => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) dispatch({ products: res.data.rows || [] });
        });
    };

    const loadEnv = (prodId: any) => {
        if (!prodId) {
            dispatch({ form: {}, snapshot: {} });
            return;
        }
        dispatch({ loading: true });
        Api.get_prod_runtime_env({ prod_id: prodId }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const f = res.data || {};
                dispatch({ loading: false, form: { ...f }, snapshot: { ...f } });
            } else {
                dispatch({ loading: false, form: {}, snapshot: {} });
                message.error(res.msg);
            }
        });
    };

    const onChange = (field: string, value: string) => {
        dispatch({ form: { ...data.form, [field]: value } });
    };

    const saveField = (field: string) => {
        if (!data.prodId) return;
        if ((data.form[field] ?? "") === (data.snapshot[field] ?? "")) return;
        dispatch({ saving: true });
        const payload: any = { prod_id: data.prodId };
        FIELDS.forEach((k) => (payload[k] = data.form[k] ?? ""));
        Api.save_prod_runtime_env(payload).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                dispatch({ snapshot: { ...data.form } });
                message.success(ts("msg_ok"));
            } else {
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        loadProducts();
    }, []);

    const cell = (field: string) => (
        <Input.TextArea
            className="env-input"
            autoSize={{ minRows: 1, maxRows: 8 }}
            value={data.form[field] ?? ""}
            disabled={!data.prodId}
            onChange={(e) => onChange(field, e.target.value)}
            onBlur={() => saveField(field)}
            placeholder={data.prodId ? "" : "请先选择产品"}
        />
    );

    return (
        <div className="page div-v prod-runtime-env">
            <div className="div-h searchbar list-searchbar-align">
                <Space>
                    <span>{ts("srs_doc.select_product")}：</span>
                    <div style={{ minWidth: 360 }}>
                        <ProductVersionSelect
                            products={data.products}
                            allowClear
                            value={data.prodId}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.version")}
                            onChange={(v: any) => {
                                dispatch({ prodId: v ?? null });
                                loadEnv(v ?? null);
                            }}
                        />
                    </div>
                </Space>
                {data.saving ? <span className="env-saving">保存中…</span> : null}
            </div>

            <Spin spinning={data.loading} wrapperClassName="env-scroll">
                <div className="env-body">
                    <h2 className="env-title">运行环境</h2>
                    <div className="env-arch">
                        {cell("arch")}
                    </div>

                    <h3 className="env-cap">表1 服务器硬件配置要求</h3>
                    <table className="env-table">
                        <colgroup>
                            <col style={{ width: 140 }} />
                            <col />
                        </colgroup>
                        <thead>
                            <tr><th>配置</th><th>要求</th></tr>
                        </thead>
                        <tbody>
                            <tr><td className="lbl">CPU</td><td>{cell("srv_cpu")}</td></tr>
                            <tr><td className="lbl">内存</td><td>{cell("srv_memory")}</td></tr>
                            <tr><td className="lbl">GPU</td><td>{cell("srv_gpu")}</td></tr>
                            <tr><td className="lbl">硬盘</td><td>{cell("srv_disk")}</td></tr>
                            <tr><td className="lbl">网卡</td><td>{cell("srv_nic")}</td></tr>
                        </tbody>
                    </table>

                    <h3 className="env-cap">表2 服务器软件配置要求</h3>
                    <table className="env-table">
                        <thead>
                            <tr><th>操作系统</th><th>CUDA</th></tr>
                        </thead>
                        <tbody>
                            <tr><td>{cell("srv_os")}</td><td>{cell("srv_cuda")}</td></tr>
                        </tbody>
                    </table>

                    <h3 className="env-cap">表3 用户端配置要求</h3>
                    <table className="env-table">
                        <colgroup>
                            <col style={{ width: 140 }} />
                            <col />
                        </colgroup>
                        <thead>
                            <tr><th>配置</th><th>要求</th></tr>
                        </thead>
                        <tbody>
                            <tr><td className="lbl">CPU</td><td>{cell("cli_cpu")}</td></tr>
                            <tr><td className="lbl">内存</td><td>{cell("cli_memory")}</td></tr>
                            <tr><td className="lbl">显示器分辨率</td><td>{cell("cli_resolution")}</td></tr>
                            <tr><td className="lbl">操作系统</td><td>{cell("cli_os")}</td></tr>
                            <tr><td className="lbl">浏览器</td><td>{cell("cli_browser")}</td></tr>
                        </tbody>
                    </table>

                    <h3 className="env-cap">表4 网络要求</h3>
                    <table className="env-table">
                        <colgroup>
                            <col style={{ width: 140 }} />
                            <col />
                            <col />
                        </colgroup>
                        <thead>
                            <tr><th>配置</th><th>局域网</th><th>广域网</th></tr>
                        </thead>
                        <tbody>
                            <tr><td className="lbl">带宽</td><td>{cell("net_lan")}</td><td>{cell("net_wan")}</td></tr>
                        </tbody>
                    </table>
                </div>
            </Spin>
        </div>
    );
};
