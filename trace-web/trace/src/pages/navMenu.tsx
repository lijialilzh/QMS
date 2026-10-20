import { MODEL_DOC_MENU, getModelDocNavTitle } from "./model_doc/ModelDocTypes";
import { DATA_DOC_MENU, getDataDocNavTitle } from "./model_doc/DataDocTypes";

export type NavNode = {
    key: string;
    label: any;
    perm?: string;
    hidden?: boolean;
    icon?: any;
    children?: NavNode[];
};

type MenuCtx = { role?: string; userId?: number };

/** 左侧导航唯一来源。角色权限卡片按这里的一级菜单自动生成。 */
export function buildAppMenus(ts: (key: string) => string, ctx: MenuCtx = {}): NavNode[] {
    const role = String(ctx.role || "");
    const user = { id: ctx.userId, role_code: role };
    const seeBaseMasters = ["root", "dqa", "qa", "product_manager"].includes(role);
    const seeFullGeneralCfg = ["root", "dqa", "qa"].includes(role);
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
                    key: "/srs_viewers",
                    label: ts("menu.srs_viewers"),
                    perm: "user_view",
                    hidden: !(user?.id === 1 || user?.role_code === "root" || user?.role_code === "dqa"),
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
                    hidden: !seeFullGeneralCfg,
                },
                {
                    key: "/version_rule",
                    label: ts("menu.version_rule"),
                    perm: "version_rule_view",
                },
                {
                    key: "/company_infos",
                    label: ts("menu.company_infos"),
                    perm: "company_info_view",
                    hidden: !seeFullGeneralCfg,
                },
                {
                    key: "/person_signs",
                    label: ts("menu.person_signs"),
                    perm: "person_sign_view",
                    hidden: !seeFullGeneralCfg,
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
                    hidden: !seeBaseMasters,
                },
                {
                    key: "/rcms",
                    label: ts("menu.rcms"),
                    perm: "rcm_view",
                    hidden: !seeBaseMasters,
                },
                {
                    key: "/csts",
                    label: ts("menu.csts"),
                    perm: "cst_view",
                    hidden: !seeBaseMasters,
                },
                {
                    key: "/prod_hospitals",
                    label: ts("menu.prod_hospitals"),
                    perm: "prod_hospital_view",
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
                            key: "/prod_algo_chapters",
                            label: ts("menu.prod_algo_mgmt"),
                            perm: "prod_algo_chapter_view",
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
                            key: "/dat_docs",
                            label: ts("menu.dat_docs"),
                            perm: "dat_doc_view",
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
                            key: "/utp_record_docs",
                            label: ts("menu.utp_record_docs"),
                            perm: "utp_record_doc_view",
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
                    perm: "srs_doc_edit",
                },
            ],
        },
        {
            key: "/manage_model_doc",
            label: ts("menu.manage_model_doc"),
            icon: <img src="assets/icon/menu-create.svg" />,
            children: MODEL_DOC_MENU.map((item) => ({
                key: item.key,
                label: item.group,
                children: item.types.map((code) => ({
                    key: `/model_docs/${code}`,
                    label: getModelDocNavTitle(code),
                    perm: "model_doc_view",
                })),
            })),
        },
        {
            key: "/manage_data_doc",
            label: ts("menu.manage_data_doc"),
            icon: <img src="assets/icon/menu-create.svg" />,
            children: DATA_DOC_MENU.map((item) => ({
                key: item.key,
                label: item.group,
                children: item.types.map((code) => ({
                    key: `/data_docs/${code}`,
                    label: getDataDocNavTitle(code),
                    perm: "data_doc_view",
                })),
            })),
        },
        {
            key: "/data_qc",
            label: ts("menu.data_qc"),
            icon: <img src="assets/icon/menu-create.svg" />,
            children: [
                {
                    key: "/data_stats",
                    label: ts("menu.data_stats"),
                    perm: "data_doc_view",
                },
                {
                    key: "/data_check",
                    label: ts("menu.data_check"),
                    perm: "data_doc_view",
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
                    perm: "pir_doc_view",
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

}

function permBase(perm: string): string {
    return String(perm || "").replace(/_(view|edit)$/, "");
}

function collectBases(nodes: NavNode[] | undefined, out: string[]) {
    for (const node of nodes || []) {
        if (node.hidden) continue;
        if (node.perm) out.push(permBase(node.perm));
        collectBases(node.children, out);
    }
}

/** 一级菜单 → 权限卡片。顺序、名称跟随导航。已被前面菜单占用、且分属多个菜单的权限不再重复控制。 */
export function scopeModulesFromMenu(menus: NavNode[]): { moduleName: string; bases: string[]; exclusiveBases: string[] }[] {
    const claimed = new Set<string>();
    const owner = new Map<string, string>();
    const rows: { moduleName: string; bases: string[]; exclusiveBases: string[] }[] = [];
    for (const menu of menus) {
        if (menu.hidden) continue;
        const found: string[] = [];
        collectBases([menu], found);
        const unique = [...new Set(found.filter(Boolean))];
        const exclusive = unique.filter((base) => !claimed.has(base));
        exclusive.forEach((base) => {
            claimed.add(base);
            owner.set(base, String(menu.label));
        });
        let bases = exclusive.length ? unique : [];
        if (!exclusive.length && unique.length) {
            const owners = new Set(unique.map((base) => owner.get(base)));
            if (owners.size === 1) bases = unique;
        }
        rows.push({ moduleName: String(menu.label), bases, exclusiveBases: exclusive });
    }
    return rows;
}

export function codesForBases(bases: string[], items: { code: string }[]): string[] {
    if (!bases.length) return [];
    const want = new Set(bases);
    return [...new Set(items.map((item) => item.code).filter((code) => want.has(permBase(code)) || want.has(code)))];
}
