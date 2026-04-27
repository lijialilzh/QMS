import "./Home.less";
import { Outlet } from "react-router-dom";
import { Drawer, Menu, message } from "antd";
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import UserInfo from "@/views/UserInfo";
import * as Api from "@/api/ApiUser";
import { Root, actions, useDispatch, useSelector } from "@/store";
import Loading from "@/views/Loading";

enum DlgTypes {
    menu = "menu",
}

const transformMenus = (menus: any, perms: any) => {
    const newMenus = menus.map((munu: any) => {
            if (!munu.children) {
                return munu;
            }
            const children = transformMenus(munu.children, perms);
            if (children.length == 0){
                return null;
            }
            return {
                ...munu,
                children,
            };
        }).filter((munu: any) => munu && (!munu.perm || perms.has(munu.perm)))
    return newMenus;
};

const findFirstLeaf = (menus: any)=>{
    for (const menu of menus) {
        if (!menu.children) {
            return menu;
        }
        const leaf = findFirstLeaf(menu.children) as any;
        if (leaf) {
            return leaf;
        }
    }
}

const findParentKeyByChild = (menus: any, targetKey: string, parentKey?: string): string | undefined => {
    for (const menu of menus) {
        if (menu.key === targetKey) {
            return parentKey;
        }
        if (menu.children) {
            const key = findParentKeyByChild(menu.children, targetKey, menu.key);
            if (key) {
                return key;
            }
        }
    }
};

const HomeMenu = ({ className, items, openKeys, selectedKeys, onClick, dispatchFn }: any) => {
    const { i18n } = useTranslation();

    return (
        <div className={`home-menu ${className}`}>
            <div className="center logo-div">
                <img className="logo" src={`assets/img/logo.${i18n.language}.png`}></img>
            </div>
            <Menu
                openKeys={openKeys}
                mode="inline"
                expandIcon={(props: any) => {
                    return props.isOpen ? <CaretDownOutlined /> : <CaretRightOutlined />;
                }}
                items={items}
                onClick={onClick}
                onOpenChange={(openKeys) => {
                    dispatchFn({ openKeys });
                }}
                selectedKeys={selectedKeys}
            />
        </div>
    );
};

export default () => {
    const dispatchStore = useDispatch();
    const user = useSelector((state: Root) => state.user);
    const location = useLocation();
    const navigate = useNavigate();
    const { t: ts, i18n } = useTranslation();
    const [data, dispatch] = useData({
        path: location.pathname,
        menus: [],
        openKeys: [],
    });

    const MENUS = useMemo(() => {
        return [
            {
                key: "/dashboard",
                label: ts("menu.dashboard"),
                icon: <img src="assets/icon/menu-general.svg" />,
                perm: "dashboard_view",
            },
            {
                key: "/syscfg",
                label: ts("menu.syscfg"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/roles",
                        label: ts("menu.roles"),
                        perm: "role_view",
                    },
                    {
                        key: "/users",
                        label: ts("menu.users"),
                        perm: "user_view",
                    },
                    {
                        key: "/projects",
                        label: ts("menu.projects"),
                        perm: "project_view",
                    },
                ],
            },
            {
                key: "/basedata",
                label: ts("menu.basedata"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/hazs",
                        label: ts("menu.hazs"),
                        perm: "haz_view",
                    },
                    {
                        key: "/rcms",
                        label: ts("menu.rcms"),
                        perm: "rcm_view",
                    },
                    {
                        key: "/csts",
                        label: ts("menu.csts"),
                        perm: "cst_view",
                    },
                ],
            },
            {
                key: "/product_version",
                label: ts("menu.product_version"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/products",
                        label: ts("menu.products"),
                        perm: "product_view",
                    },
                ],
            },
            {
                key: "/manage_prod_info",
                label: ts("menu.manage_prod_info"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/prod_dhfs",
                        label: ts("menu.prod_dhfs"),
                        perm: "prod_dhf_view",
                    },
                    {
                        key: "/test_sets",
                        label: ts("menu.test_sets"),
                        perm: "test_set_view",
                    },
                ],
            },
            {
                key: "/manage_srs_doc",
                label: ts("menu.manage_srs_doc"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/srs_docs",
                        label: ts("menu.srs_docs"),
                        perm: "srs_doc_view",
                    },
                    {
                        key: "/srs_manage",
                        label: ts("menu.srs_manage"),
                        perm: "srs_doc_view",
                    },
                    {
                        key: "/srs_req",
                        label: ts("menu.srs_req"),
                        perm: "srs_doc_view",
                    },
                ],
            },
            {
                key: "/manage_sds_doc",
                label: ts("menu.manage_sds_doc"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/sds_docs",
                        label: ts("menu.sds_docs"),
                        perm: "sds_doc_view",
                    },
                    {
                        key: "/sds_traces",
                        label: ts("menu.sds_traces"),
                        perm: "sds_doc_view",
                    },
                    {
                        key: "/sds_reqds",
                        label: ts("menu.sds_reqds"),
                        perm: "sds_doc_view",
                    },
                ],
            },
            {
                key: "/doc_file",
                label: ts("menu.doc_file"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/doc_files_topo",
                        label: ts("menu.doc_files_topo"),
                        perm: "doc_file_topo_view",
                    },
                    {
                        key: "/doc_files_struct",
                        label: ts("menu.doc_files_struct"),
                        perm: "doc_file_struct_view",
                    },
                    {
                        key: "/doc_files_flow",
                        label: ts("menu.doc_files_flow"),
                        perm: "doc_file_flow_view",
                    },
                ],
            },
            {
                key: "/prod_risk",
                label: ts("menu.prod_risk"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/prod_hazs",
                        label: ts("menu.prod_hazs"),
                        perm: "prod_haz_view",
                    },
                    {
                        key: "/prod_rcms",
                        label: ts("menu.prod_rcms"),
                        perm: "prod_rcm_view",
                    },
                    {
                        key: "/prod_csts",
                        label: ts("menu.prod_csts"),
                        perm: "prod_cst_view",
                    },
                    {
                        key: "/srs_doc_trace",
                        label: ts("menu.srs_doc_trace"),
                        perm: "srs_doc_view",
                    },
                ],
            },
            {
                key: "/prod_overview",
                label: ts("menu.prod_overview"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/prod_traces",
                        label: ts("menu.prod_traces"),
                        perm: "product_view",
                    },
                    {
                        key: "/prod_comparison",
                        label: ts("menu.prod_comparison"),
                        perm: "product_view",
                    }
                ],
            }
        ];
    }, [i18n.language]);

    useEffect(() => {
        const path = location.pathname;
        const pathParts = path.split("/").filter(Boolean);
        const isDetailPage = pathParts.length > 1;
        // 详情页时菜单高亮父级：/srs_docs/edit/1 -> /srs_docs
        const menuSelectedKey = isDetailPage ? `/${pathParts[0]}` : path;

        let pageKey = path.replace(/\//, "").replace("-", "_");
        if (isDetailPage) {
            pageKey = pathParts[0].replace("-", "_");
        }
        const pageName = ts(`menu.${pageKey}`);
        dispatch({ path: location.pathname, pageName, isDetailPage, menuSelectedKey });
    }, [location, i18n.language]);

    useEffect(() => {
        if (!user.id) {
            dispatch({ loadingUser: true });
            Api.current_user().then((res) => {
                dispatch({ loadingUser: false });
                if (res.code !== Api.C_OK) {
                    message.error(res.msg || ts("msg.error"));
                    return;
                }
                const freshUser = res.data || {};
                dispatchStore(actions.user.update(freshUser));
            });
        }
    }, [user]);

    useEffect(() => {
        if (user.id) {
            const role_perms = new Set(user.role_perms || []);
            const menus = transformMenus(MENUS, role_perms);
            const selectedKey = data.menuSelectedKey ?? data.path;
            const parentKey = selectedKey ? findParentKeyByChild(menus, selectedKey) : undefined;
            // 初始化时仅展开当前菜单所属父级，若为一级菜单则全部收起
            dispatch({ menus, openKeys: parentKey ? [parentKey] : [] });
            if (menus.length > 0) {
                const leaf = findFirstLeaf(menus) as any;
                if ((!data.path || data.path === "/") && leaf) {
                    navigate(leaf.key);
                }
            }
        }
    }, [user, i18n.language, data.menuSelectedKey, data.path]);

    if (data.loadingUser) {
        return <Loading />;
    } else if (!user.id) {
        return null;
    }
    return (
        <div className="page div-h">
            <HomeMenu
                className="home-left"
                items={data.menus}
                openKeys={data.openKeys}
                selectedKeys={[data.menuSelectedKey ?? data.path]}
                dispatchFn={dispatch}
                onClick={(e: any) => navigate(e.key)}
            />
            <div className="expand div-v">
                <div className="div-h center-v home-header">
                    <img
                        className="cursor-on menu-switch"
                        src="assets/icon/col-off.svg"
                        onClick={() => {
                            const dlgType = data.dlgType === DlgTypes.menu ? null : DlgTypes.menu;
                            dispatch({ dlgType });
                        }}
                    />
                    <div className="nowrap page-title">{data.pageName}</div>
                    <div className="expand div-hr home-bar">
                        <UserInfo />
                    </div>
                </div>
                <div className={data.isDetailPage ? "expand" : "home-body"}>
                    <Outlet />
                </div>
            </div>
            <Drawer
                styles={{ header: { display: "none" } }}
                rootClassName="menu-drawer"
                placement="left"
                open={data.dlgType === DlgTypes.menu}
                onClose={() => dispatch({ dlgType: null })}>
                {data.dlgType === DlgTypes.menu && (
                    <HomeMenu
                        items={data.menus}
                        openKeys={data.openKeys}
                        selectedKeys={[data.menuSelectedKey ?? data.path]}
                        dispatchFn={dispatch}
                        onClick={(e: any) => {
                            dispatch({ dlgType: null });
                            navigate(e.key);
                        }}
                    />
                )}
            </Drawer>
        </div>
    );
};
