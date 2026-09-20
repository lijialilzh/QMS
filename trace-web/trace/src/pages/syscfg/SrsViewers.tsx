import { Button, Checkbox, Table, message } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { Root, useSelector } from "@/store";
import * as ApiUser from "@/api/ApiUser";
import * as ApiProduct from "@/api/ApiProduct";

const isUnrestrictedAccount = (row: any) => {
    return row?.id === 1 || row?.role_code === "root" || row?.role_code === "dqa" || row?.name === "master";
};

export default () => {
    const { t: ts } = useTranslation();
    const user = useSelector((state: Root) => state.user);
    const canConfig = user?.id === 1 || user?.role_code === "root" || user?.role_code === "dqa";
    const [data, dispatch] = useData({
        users: [] as any[],
        products: [] as any[],
        viewerMap: {} as Record<number, { product_ids: number[]; created_product_ids: number[] }>,
        selectedUserId: 0,
        checkedIds: [] as number[],
        createdIds: [] as number[],
        loading: false,
        saving: false,
    });

    const loadAll = () => {
        dispatch({ loading: true });
        Promise.all([
            ApiUser.list_user({ page_index: 0, page_size: 10000 }),
            ApiProduct.list_product({ page_index: 0, page_size: 10000 }),
            ApiProduct.list_srs_viewer_map(),
        ]).then(([userRes, prodRes, mapRes]: any[]) => {
            const next: any = { loading: false };
            if (userRes.code === ApiUser.C_OK) {
                next.users = (userRes.data?.rows || []).filter((row: any) => !isUnrestrictedAccount(row));
            } else {
                message.error(userRes.msg);
            }
            if (prodRes.code === ApiProduct.C_OK) {
                next.products = prodRes.data?.rows || [];
            } else {
                message.error(prodRes.msg);
            }
            if (mapRes.code === ApiProduct.C_OK) {
                const mp: Record<number, { product_ids: number[]; created_product_ids: number[] }> = {};
                (mapRes.data || []).forEach((item: any) => {
                    mp[item.user_id] = {
                        product_ids: item.product_ids || [],
                        created_product_ids: item.created_product_ids || [],
                    };
                });
                next.viewerMap = mp;
            } else {
                message.error(mapRes.msg);
            }
            dispatch(next);
        }).catch(() => dispatch({ loading: false }));
    };

    useEffect(() => {
        if (canConfig) {
            loadAll();
        }
    }, [canConfig]);

    const applyUser = (userId: number, viewerMap = data.viewerMap, products = data.products) => {
        const item = viewerMap[userId] || { product_ids: [], created_product_ids: [] };
        const createdIds = (item.created_product_ids || []).length
            ? item.created_product_ids
            : (products || []).filter((p: any) => p.create_user_id === userId).map((p: any) => p.id);
        const checkedIds = Array.from(new Set([...(item.product_ids || []), ...createdIds]));
        dispatch({ selectedUserId: userId, createdIds, checkedIds });
    };

    const toggleProduct = (productId: number, checked: boolean) => {
        if ((data.createdIds || []).includes(productId)) return;
        const set = new Set(data.checkedIds || []);
        if (checked) set.add(productId);
        else set.delete(productId);
        dispatch({ checkedIds: Array.from(set) });
    };

    const doSave = () => {
        if (!data.selectedUserId) {
            message.warning("请选择用户");
            return;
        }
        const productIds = Array.from(new Set([...(data.checkedIds || []), ...(data.createdIds || [])]));
        dispatch({ saving: true });
        ApiProduct.save_srs_viewers({ user_id: data.selectedUserId, product_ids: productIds }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === ApiProduct.C_OK) {
                message.success(res.msg);
                const viewerMap = {
                    ...data.viewerMap,
                    [data.selectedUserId]: {
                        product_ids: productIds,
                        created_product_ids: data.createdIds || [],
                    },
                };
                dispatch({ viewerMap });
            } else {
                message.error(res.msg);
            }
        }).catch(() => dispatch({ saving: false }));
    };

    if (!canConfig) {
        return <div className="page">{ts("msg_no_perm") || "您没有权限执行此操作"}</div>;
    }

    const columns = [
        { title: ts("account"), dataIndex: "name" },
        { title: ts("nick_name"), dataIndex: "nick_name" },
        { title: ts("role_name"), dataIndex: "role_name" },
    ];

    return (
        <div className="page div-v">
            <div style={{ marginBottom: 12, color: "#666", lineHeight: 1.8 }}>
                从左侧选择用户，勾选该用户可查看需求规格说明的产品。未勾选的产品，该用户在需求规格说明中看不到。超级管理员与 DQA 默认可见全部产品，不在此列表中配置。
            </div>
            <div className="div-h expand" style={{ gap: 16, minHeight: 0 }}>
                <div className="div-v" style={{ width: 420 }}>
                    <Table
                        size="small"
                        className="expand"
                        columns={columns}
                        rowKey={(item: any) => item.id}
                        dataSource={data.users}
                        loading={data.loading}
                        pagination={false}
                        rowClassName={(row: any) => (row.id === data.selectedUserId ? "ant-table-row-selected" : "")}
                        onRow={(row: any) => ({
                            onClick: () => applyUser(row.id),
                        })}
                    />
                </div>
                <div className="expand div-v">
                    <div className="div-h" style={{ marginBottom: 12, alignItems: "center" }}>
                        <div className="expand">
                            {data.selectedUserId ? "勾选可见产品" : "请先在左侧选择用户"}
                        </div>
                        <Button type="primary" disabled={!data.selectedUserId} loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    </div>
                    <div className="expand" style={{ overflow: "auto", border: "1px solid #f0f0f0", padding: 12 }}>
                        {(data.products || []).map((item: any) => {
                            const created = (data.createdIds || []).includes(item.id);
                            const checked = (data.checkedIds || []).includes(item.id);
                            return (
                                <div key={item.id} style={{ marginBottom: 8 }}>
                                    <Checkbox
                                        disabled={!data.selectedUserId || created}
                                        checked={checked}
                                        onChange={(e) => toggleProduct(item.id, e.target.checked)}>
                                        {item.name}-{item.full_version}{created ? "（创建人，默认可见）" : ""}
                                    </Checkbox>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
