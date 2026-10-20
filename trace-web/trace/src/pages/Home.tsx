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
import { MODEL_DOC_TYPES, getModelDocNavTitle, getModelDocMenuKey } from "./model_doc/ModelDocTypes";
import { DATA_DOC_TYPES, getDataDocNavTitle, getDataDocMenuKey } from "./model_doc/DataDocTypes";
import { buildAppMenus } from "./navMenu";

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

    const MENUS = useMemo(() => buildAppMenus(ts, {
        role: String(user?.role_code || ""),
        userId: user?.id,
    }), [i18n.language, user?.id, user?.role_code]);

    useEffect(() => {
        const path = location.pathname;
        const pathParts = path.split("/").filter(Boolean);
        const isModelDoc = pathParts[0] === "model_docs";
        const isDataDoc = pathParts[0] === "data_docs";
        const isTypedDoc = isModelDoc || isDataDoc;
        const isDetailPage = isTypedDoc ? pathParts.length > 2 : pathParts.length > 1;
        // 模型/数据文件子类型（如 md_008_01、dd_005_01）归一到分组入口高亮
        const rawTypeKey = isTypedDoc && pathParts.length >= 2 ? pathParts[1] : "";
        const typeKey = isModelDoc
            ? getModelDocMenuKey(rawTypeKey)
            : isDataDoc
            ? getDataDocMenuKey(rawTypeKey)
            : rawTypeKey;
        const menuSelectedKey = path === "/prod_algo_modules"
            ? "/prod_algo_chapters"
            : isTypedDoc
            ? `/${pathParts[0]}/${typeKey}`
            : (isDetailPage ? `/${pathParts[0]}` : path);

        let pageKey = path.replace(/\//, "").replace("-", "_");
        if (isDetailPage) {
            pageKey = pathParts[0].replace("-", "_");
        }
        if (pageKey === "prod_algo_chapters" || pageKey === "prod_algo_modules") {
            pageKey = "prod_algo_mgmt";
        }
        const pageName = isModelDoc && pathParts[1]
            ? (MODEL_DOC_TYPES[pathParts[1]] ? MODEL_DOC_TYPES[pathParts[1]].title : getModelDocNavTitle(pathParts[1]))
            : isDataDoc && pathParts[1]
            ? (DATA_DOC_TYPES[pathParts[1]] ? DATA_DOC_TYPES[pathParts[1]].title : getDataDocNavTitle(pathParts[1]))
            : ts(`menu.${pageKey}`);
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
