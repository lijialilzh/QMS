import "./Home.less";
import { Outlet } from "react-router-dom";
import { Drawer, Menu, message } from "antd";
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import UserInfo from "@/views/UserInfo";
import AiAssistant from "@/views/AiAssistant";
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
        }).filter((munu: any) => munu && !munu.hidden && (!munu.perm || perms.has(munu.perm)))
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

// 返回从顶级到目标节点父级的所有祖先 key（支持多级子菜单展开）
const findAncestorKeys = (menus: any, targetKey: string, ancestors: string[] = []): string[] | undefined => {
    for (const menu of menus) {
        if (menu.key === targetKey) {
            return ancestors;
        }
        if (menu.children) {
            const keys = findAncestorKeys(menu.children, targetKey, [...ancestors, menu.key]);
            if (keys) {
                return keys;
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
                inlineIndent={16}
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
                key: "/base_cfg",
                label: ts("menu.base_cfg"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "/print_service_cfg",
                        label: ts("menu.print_service_cfg"),
                        perm: "print_cfg_view",
                    },
                    {
                        key: "/version_rule",
                        label: ts("menu.version_rule"),
                    },
                    {
                        key: "/company_infos",
                        label: ts("menu.company_infos"),
                        perm: "company_info_view",
                    },
                    {
                        key: "/person_signs",
                        label: ts("menu.person_signs"),
                        perm: "person_sign_view",
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
                        key: "prod_basic",
                        label: ts("menu.prod_basic"),
                        children: [
                            {
                                key: "/products",
                                label: ts("menu.products"),
                                perm: "product_view",
                            },
                            {
                                key: "/project_members",
                                label: ts("menu.project_members"),
                                perm: "project_member_view",
                            },
                            {
                                key: "/project_timeline",
                                label: ts("menu.project_timeline"),
                                perm: "project_timeline_view",
                            },
                            {
                                key: "/prod_runtime_env",
                                label: ts("menu.prod_runtime_env"),
                                perm: "prod_runtime_view",
                            },
                            {
                                key: "/prod_device_res",
                                label: ts("menu.prod_device_res"),
                                perm: "prod_device_view",
                            },
                            {
                                key: "/prod_dhfs",
                                label: ts("menu.prod_dhfs"),
                                perm: "prod_dhf_view",
                            },
                        ],
                    },
                    {
                        key: "prod_risk_mgmt",
                        label: ts("menu.prod_risk_mgmt"),
                        children: [
                            {
                                key: "/risk_participants",
                                label: ts("menu.risk_participants"),
                                perm: "risk_mgmt_doc_view",
                            },
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
                        ],
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
                        key: "/doc_files_ui",
                        label: ts("menu.doc_files_ui"),
                        perm: "doc_file_ui_view",
                    },
                    {
                        key: "/doc_files_flow",
                        label: ts("menu.doc_files_flow"),
                        perm: "doc_file_flow_view",
                    },
                    {
                        key: "/doc_files_home",
                        label: ts("menu.doc_files_home"),
                        perm: "doc_file_home_view",
                    },
                ],
            },
            {
                key: "/manage_srs_doc",
                label: ts("menu.manage_srs_doc"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "prod_files",
                        label: ts("menu.prod_files"),
                        children: [
                            {
                                key: "/pir_docs",
                                label: ts("menu.pir_docs"),
                                perm: "pir_doc_view",
                            },
                            {
                                key: "/pdp_docs",
                                label: ts("menu.pdp_docs"),
                                perm: "pdp_doc_view",
                            },
                            {
                                key: "/srs_docs",
                                label: ts("menu.srs_docs"),
                                perm: "srs_doc_view",
                            },
                            {
                                key: "/acc_docs",
                                label: ts("menu.acc_docs"),
                                perm: "acc_doc_view",
                            },
                            {
                                key: "/release_notes",
                                label: ts("menu.release_notes"),
                                perm: "release_note_view",
                            },
                            {
                                key: "/vuh_docs",
                                label: ts("menu.vuh_docs"),
                                perm: "vuh_doc_view",
                            },
                            {
                                key: "/ptr_docs",
                                label: ts("menu.ptr_docs"),
                                perm: "ptr_doc_view",
                            },
                            {
                                key: "/research_docs",
                                label: ts("menu.research_docs"),
                                perm: "research_doc_view",
                            },
                        ],
                    },
                    {
                        key: "risk_files",
                        label: ts("menu.risk_files"),
                        children: [
                            {
                                key: "/rmp_docs",
                                label: ts("menu.rmp_docs"),
                                perm: "rmp_doc_view",
                            },
                            {
                                key: "/pha_docs",
                                label: ts("menu.pha_docs"),
                                perm: "pha_doc_view",
                            },
                            {
                                key: "/nsr_docs",
                                label: ts("menu.nsr_docs"),
                                perm: "nsr_doc_view",
                            },
                            {
                                key: "/cyber_cap_docs",
                                label: ts("menu.cyber_cap_docs"),
                                perm: "cyber_cap_doc_view",
                            },
                            {
                                key: "/label_docs",
                                label: ts("menu.label_docs"),
                                perm: "label_doc_view",
                            },
                            {
                                key: "/nsmp_docs",
                                label: ts("menu.nsmp_docs"),
                                perm: "nsmp_doc_view",
                            },
                            {
                                key: "/risk_mgmt_docs",
                                label: ts("menu.risk_mgmt_docs"),
                                perm: "risk_mgmt_doc_view",
                            },
                        ],
                    },
                    {
                        key: "prod_other_files",
                        label: ts("menu.prod_other_files"),
                        children: [
                            {
                                key: "/train_record_docs",
                                label: "培训记录表",
                                perm: "ftr_record_doc_view",
                            },
                        ],
                    },
                ],
            },
            {
                key: "/manage_sds_doc",
                label: ts("menu.manage_sds_doc"),
                icon: <img src="assets/icon/menu-create.svg" />,
                children: [
                    {
                        key: "dev_files",
                        label: ts("menu.dev_files"),
                        children: [
                            {
                                key: "/scm_docs",
                                label: ts("menu.scm_docs"),
                                perm: "scm_doc_view",
                            },
                            {
                                key: "/scs_docs",
                                label: ts("menu.scs_docs"),
                                perm: "scs_doc_view",
                            },
                            {
                                key: "/sd_docs",
                                label: ts("menu.sd_docs"),
                                perm: "sd_doc_view",
                            },
                            {
                                key: "/sds_docs",
                                label: ts("menu.sds_docs"),
                                perm: "sds_doc_view",
                            },
                            {
                                key: "/hld_docs",
                                label: ts("menu.hld_docs"),
                                perm: "hld_doc_view",
                            },
                            {
                                key: "/dem_docs",
                                label: ts("menu.dem_docs"),
                                perm: "dem_doc_view",
                            },
                            {
                                key: "/crr_docs",
                                label: ts("menu.crr_docs"),
                                perm: "crr_doc_view",
                            },
                            {
                                key: "/dat_docs",
                                label: ts("menu.dat_docs"),
                                perm: "dat_doc_view",
                            },
                            {
                                key: "/deq_docs",
                                label: ts("menu.deq_docs"),
                                perm: "deq_doc_view",
                            },
                        ],
                    },
                    {
                        key: "test_files",
                        label: ts("menu.test_files"),
                        children: [
                            {
                                key: "/stp_docs",
                                label: ts("menu.stp_docs"),
                                perm: "stp_doc_view",
                            },
                            {
                                key: "/bug_docs",
                                label: ts("menu.bug_docs"),
                                perm: "bug_doc_view",
                            },
                            {
                                key: "/str_docs",
                                label: ts("menu.str_docs"),
                                perm: "str_doc_view",
                            },
                            {
                                key: "/tem_docs",
                                label: ts("menu.tem_docs"),
                                perm: "tem_doc_view",
                            },
                            {
                                key: "/imm_docs",
                                label: ts("menu.imm_docs"),
                                perm: "imm_doc_view",
                            },
                            {
                                key: "/ftr_docs",
                                label: ts("menu.ftr_docs"),
                                perm: "ftr_doc_view",
                            },
                            {
                                key: "/ftr_record_docs",
                                label: ts("menu.ftr_record_docs"),
                                perm: "ftr_record_doc_view",
                            },
                            {
                                key: "/utp_docs",
                                label: ts("menu.utp_docs"),
                                perm: "utp_doc_view",
                            },
                            {
                                key: "/utr_docs",
                                label: ts("menu.utr_docs"),
                                perm: "utr_doc_view",
                            },
                            {
                                key: "/teq_docs",
                                label: ts("menu.teq_docs"),
                                perm: "teq_doc_view",
                            },
                            {
                                key: "/test_sets",
                                label: ts("menu.test_sets"),
                                perm: "test_set_view",
                            },
                        ],
                    },
                    {
                        key: "cybersec_files",
                        label: ts("menu.cybersec"),
                        children: [
                            {
                                key: "/cybersec_plan_docs",
                                label: ts("menu.cybersec_plan_docs"),
                                perm: "cybersec_plan_doc_view",
                            },
                            {
                                key: "/cybersec_docs",
                                label: ts("menu.cybersec_docs"),
                                perm: "cybersec_doc_view",
                            },
                        ],
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
                        hidden: true,
                    },
                    {
                        key: "/doc_comparison",
                        label: "文档内容比对",
                        perm: "product_view",
                    },
                    {
                        key: "doc_integrate_export",
                        label: ts("menu.doc_integrate_export"),
                        children: [
                            {
                                key: "/doc_integrate_export",
                                label: ts("menu.doc_integrate_export"),
                                perm: "product_view",
                            },
                            {
                                key: "/doc_export_records",
                                label: ts("menu.doc_export_records"),
                                perm: "product_view",
                            },
                        ],
                    },
                    {
                        key: "doc_one_click_print",
                        label: ts("menu.doc_one_click_print"),
                        children: [
                            {
                                key: "/doc_one_click_print",
                                label: ts("menu.doc_one_click_print"),
                                perm: "product_view",
                            },
                            {
                                key: "/doc_print_records",
                                label: ts("menu.doc_print_records"),
                                perm: "product_view",
                            },
                        ],
                    },
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
            const ancestorKeys = selectedKey ? findAncestorKeys(menus, selectedKey) : undefined;
            // 初始化时展开当前菜单的全部祖先层级，若为一级菜单则全部收起
            dispatch({ menus, openKeys: ancestorKeys && ancestorKeys.length ? ancestorKeys : [] });
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
            <AiAssistant />
        </div>
    );
};
