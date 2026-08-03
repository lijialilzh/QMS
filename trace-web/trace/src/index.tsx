import "./index.less";
import "./index.app.less";
import "./index.ant.less";

import { createHashRouter as createRouter, RouterProvider } from "react-router-dom";
import { useTranslation } from "react-i18next";
import React, { useEffect } from "react";
import { ConfigProvider } from "antd";
import ReactDOM from "react-dom/client";
import * as I18N from "./i18n";
import { useData } from "./common";
import { Provider } from "react-redux";
import { store } from "./store";
import { ANT_LOCALES } from "./i18n/anti18n";

import Login from "./pages/Login";
import Home from "./pages/Home";
import DashBoard from "./pages/DashBoard";
import Roles from "./pages/syscfg/Roles";
import Users from "./pages/syscfg/Users";
import Projects from "./pages/syscfg/Projects";
import ProjectMembers from "./pages/syscfg/ProjectMembers";
import ProjectTimeline from "./pages/syscfg/ProjectTimeline";
import ProdRuntimeEnv from "./pages/syscfg/ProdRuntimeEnv";
import PrintServiceCfg from "./pages/syscfg/PrintServiceCfg";
import ProdDeviceRes from "./pages/syscfg/ProdDeviceRes";
import Hazs from "./pages/basedata/Hazs";
import Rcms from "./pages/basedata/Rcms";
import Csts from "./pages/basedata/Csts";
import Products from "./pages/product/Products";
import SrsDocs from "./pages/srs_doc/SrsDocs";
import SdsDocs from "./pages/sds_doc/SdsDocs";
import SrsDocDetail from "./pages/srs_doc/SrsDocDetail";
import SdsDocDetail from "./pages/sds_doc/SdsDocDetail";
import TestSets from "./pages/test_set/TestSets";
import DocFiles from "./pages/doc_file/DocFiles";
import ProdHazs from "./pages/prod_risk/prod_haz";
import ProdRcms from "./pages/prod_risk/prod_rcm";
import ProdCsts from "./pages/prod_risk/prod_cst";
import ProdDhfs from "./pages/prod_risk/ProdDhfs";
import SrsDocTrace from "./pages/prod_risk/SrsDocTrace";
import ProdTraces from "./pages/overview/ProdTraces";
import ProdComparison from "./pages/overview/ProdComparison";
import DocIntegrateExport from "./pages/overview/DocIntegrateExport";
import DocOneClickPrint from "./pages/overview/DocOneClickPrint";
import DocExportRecords from "./pages/overview/DocExportRecords";
import DocPrintRecords from "./pages/overview/DocPrintRecords";
import RiskMgmtDocs from "./pages/risk_mgmt/RiskMgmtDocs";
import RiskMgmtDocDetail from "./pages/risk_mgmt/RiskMgmtDocDetail";
import RiskMgmtParticipants from "./pages/risk_mgmt/RiskMgmtParticipants";
import CybersecDocs from "./pages/cybersec/CybersecDocs";
import CybersecDocDetail from "./pages/cybersec/CybersecDocDetail";
import PdpDocs from "./pages/pdp/PdpDocs";
import PdpDocDetail from "./pages/pdp/PdpDocDetail";
import SdDocs from "./pages/sd/SdDocs";
import SdDocDetail from "./pages/sd/SdDocDetail";
import CrrDocs from "./pages/crr/CrrDocs";
import CrrDocDetail from "./pages/crr/CrrDocDetail";
import DemDocs from "./pages/dem/DemDocs";
import DemDocDetail from "./pages/dem/DemDocDetail";
import DeqDocs from "./pages/deq/DeqDocs";
import DeqDocDetail from "./pages/deq/DeqDocDetail";
import TeqDocs from "./pages/teq/TeqDocs";
import TeqDocDetail from "./pages/teq/TeqDocDetail";
import TemDocs from "./pages/tem/TemDocs";
import TemDocDetail from "./pages/tem/TemDocDetail";
import ImmDocs from "./pages/imm/ImmDocs";
import ImmDocDetail from "./pages/imm/ImmDocDetail";
import ScmDocs from "./pages/scm/ScmDocs";
import ScmDocDetail from "./pages/scm/ScmDocDetail";
import ScsDocs from "./pages/scs/ScsDocs";
import ScsDocDetail from "./pages/scs/ScsDocDetail";
import DatDocs from "./pages/dat/DatDocs";
import DatDocDetail from "./pages/dat/DatDocDetail";
import StpDocs from "./pages/stp/StpDocs";
import StpDocDetail from "./pages/stp/StpDocDetail";
import FtrDocs from "./pages/ftr/FtrDocs";
import FtrDocDetail from "./pages/ftr/FtrDocDetail";
import FtrRecordDocs from "./pages/ftr/FtrRecordDocs";
import TrainRecordDocs from "./pages/train_record/TrainRecordDocs";
import TrainRecordDocDetail from "./pages/train_record/TrainRecordDocDetail";
import FtrRecordDocDetail from "./pages/ftr/FtrRecordDocDetail";
import UtpDocs from "./pages/utp/UtpDocs";
import UtpDocDetail from "./pages/utp/UtpDocDetail";
import UtrDocs from "./pages/utr/UtrDocs";
import UtrDocDetail from "./pages/utr/UtrDocDetail";
import StrDocs from "./pages/str/StrDocs";
import StrDocDetail from "./pages/str/StrDocDetail";
import BugDocs from "./pages/bug/BugDocs";
import PirDocs from "./pages/pir/PirDocs";
import PirDocDetail from "./pages/pir/PirDocDetail";
import VuhDocs from "./pages/vuh/VuhDocs";
import VuhDocDetail from "./pages/vuh/VuhDocDetail";
import PtrDocs from "./pages/ptr/PtrDocs";
import PtrDocDetail from "./pages/ptr/PtrDocDetail";
import AccDocs from "./pages/acc/AccDocs";
import AccDocDetail from "./pages/acc/AccDocDetail";
import NsmpDocs from "./pages/nsmp/NsmpDocs";
import NsmpDocDetail from "./pages/nsmp/NsmpDocDetail";
import RmpDocs from "./pages/rmp/RmpDocs";
import RmpDocDetail from "./pages/rmp/RmpDocDetail";
import LabelDocs from "./pages/label/LabelDocs";
import LabelDocDetail from "./pages/label/LabelDocDetail";
import ReleaseNotes from "./pages/release_note/ReleaseNotes";
import ReleaseNoteDetail from "./pages/release_note/ReleaseNoteDetail";
import PhaDocs from "./pages/pha/PhaDocs";
import PhaDocDetail from "./pages/pha/PhaDocDetail";
import CyberCapDocs from "./pages/cyber_cap/CyberCapDocs";
import CyberCapDocDetail from "./pages/cyber_cap/CyberCapDocDetail";
import ResearchDocs from "./pages/research/ResearchDocs";
import ResearchDocDetail from "./pages/research/ResearchDocDetail";
import NsrDocs from "./pages/nsr/NsrDocs";
import NsrDocDetail from "./pages/nsr/NsrDocDetail";
import VersionRule from "./pages/version_rule/VersionRule";
import CompanyInfos from "./pages/basedata/CompanyInfos";
import PersonSigns from "./pages/basedata/PersonSigns";

const DEF_LANG = localStorage.getItem("lang") || I18N.DEF_LANG;
I18N.init(DEF_LANG);

const router = createRouter([
    { path: "/login", element: <Login /> },
    {
        path: "/",
        element: <Home />,
        children: [
            { path: "/dashboard", element: <DashBoard /> },
            
            { path: "/roles", element: <Roles /> },
            { path: "/users", element: <Users /> },
            { path: "/projects", element: <Projects /> },
            { path: "/project_members", element: <ProjectMembers /> },
            { path: "/project_timeline", element: <ProjectTimeline /> },
            { path: "/prod_runtime_env", element: <ProdRuntimeEnv /> },
            { path: "/print_service_cfg", element: <PrintServiceCfg /> },
            { path: "/prod_device_res", element: <ProdDeviceRes /> },

            { path: "/hazs", element: <Hazs /> },
            { path: "/rcms", element: <Rcms /> },
            { path: "/csts", element: <Csts /> },
            { path: "/version_rule", element: <VersionRule /> },
            { path: "/company_infos", element: <CompanyInfos /> },
            { path: "/person_signs", element: <PersonSigns /> },

            { path: "/products", element: <Products /> },
            { path: "/prod_dhfs", element: <ProdDhfs /> },
            
            { path: "/srs_docs", element: <SrsDocs /> },
            { path: "/srs_docs/add", element: <SrsDocDetail /> },
            { path: "/srs_docs/edit/:id", element: <SrsDocDetail /> },
            { path: "/srs_docs/view/:id", element: <SrsDocDetail /> },

            { path: "/sds_docs", element: <SdsDocs /> },
            { path: "/sds_docs/add", element: <SdsDocDetail /> },
            { path: "/sds_docs/edit/:id", element: <SdsDocDetail /> },
            { path: "/sds_docs/view/:id", element: <SdsDocDetail /> },

            { path: "/test_sets", element: <TestSets /> },

            { path: "/doc_files_topo", element: <DocFiles fileType="img_topo" /> },
            { path: "/doc_files_ui", element: <DocFiles fileType="img_ui" /> },
            { path: "/doc_files_flow", element: <DocFiles fileType="img_flow" /> },
            { path: "/doc_files_struct", element: <DocFiles fileType="img_struct" /> },

            { path: "/prod_hazs", element: <ProdHazs /> },
            { path: "/prod_rcms", element: <ProdRcms /> },
            { path: "/prod_csts", element: <ProdCsts /> },
            { path: "/srs_doc_trace", element: <SrsDocTrace /> },

            { path: "/risk_mgmt_docs", element: <RiskMgmtDocs /> },
            { path: "/risk_mgmt_docs/add", element: <RiskMgmtDocDetail /> },
            { path: "/risk_mgmt_docs/edit/:id", element: <RiskMgmtDocDetail /> },
            { path: "/risk_mgmt_docs/view/:id", element: <RiskMgmtDocDetail /> },
            { path: "/risk_participants", element: <RiskMgmtParticipants /> },

            { path: "/cybersec_docs", element: <CybersecDocs /> },
            { path: "/cybersec_docs/add", element: <CybersecDocDetail /> },
            { path: "/cybersec_docs/edit/:id", element: <CybersecDocDetail /> },
            { path: "/cybersec_docs/view/:id", element: <CybersecDocDetail /> },
            { path: "/pdp_docs", element: <PdpDocs /> },
            { path: "/pdp_docs/edit/:id", element: <PdpDocDetail /> },
            { path: "/pdp_docs/view/:id", element: <PdpDocDetail /> },
            { path: "/sd_docs", element: <SdDocs /> },
            { path: "/sd_docs/edit/:id", element: <SdDocDetail /> },
            { path: "/sd_docs/view/:id", element: <SdDocDetail /> },
            { path: "/crr_docs", element: <CrrDocs /> },
            { path: "/crr_docs/edit/:id", element: <CrrDocDetail /> },
            { path: "/crr_docs/view/:id", element: <CrrDocDetail /> },
            { path: "/dem_docs", element: <DemDocs /> },
            { path: "/dem_docs/edit/:id", element: <DemDocDetail /> },
            { path: "/dem_docs/view/:id", element: <DemDocDetail /> },
            { path: "/deq_docs", element: <DeqDocs /> },
            { path: "/deq_docs/edit/:id", element: <DeqDocDetail /> },
            { path: "/deq_docs/view/:id", element: <DeqDocDetail /> },
            { path: "/teq_docs", element: <TeqDocs /> },
            { path: "/teq_docs/edit/:id", element: <TeqDocDetail /> },
            { path: "/teq_docs/view/:id", element: <TeqDocDetail /> },
            { path: "/tem_docs", element: <TemDocs /> },
            { path: "/tem_docs/edit/:id", element: <TemDocDetail /> },
            { path: "/tem_docs/view/:id", element: <TemDocDetail /> },
            { path: "/imm_docs", element: <ImmDocs /> },
            { path: "/imm_docs/edit/:id", element: <ImmDocDetail /> },
            { path: "/imm_docs/view/:id", element: <ImmDocDetail /> },
            { path: "/scm_docs", element: <ScmDocs /> },
            { path: "/scm_docs/edit/:id", element: <ScmDocDetail /> },
            { path: "/scm_docs/view/:id", element: <ScmDocDetail /> },
            { path: "/scs_docs", element: <ScsDocs /> },
            { path: "/scs_docs/edit/:id", element: <ScsDocDetail /> },
            { path: "/scs_docs/view/:id", element: <ScsDocDetail /> },
            { path: "/dat_docs", element: <DatDocs /> },
            { path: "/dat_docs/edit/:id", element: <DatDocDetail /> },
            { path: "/dat_docs/view/:id", element: <DatDocDetail /> },
            { path: "/stp_docs", element: <StpDocs /> },
            { path: "/stp_docs/edit/:id", element: <StpDocDetail /> },
            { path: "/stp_docs/view/:id", element: <StpDocDetail /> },
            { path: "/ftr_docs", element: <FtrDocs /> },
            { path: "/ftr_docs/edit/:id", element: <FtrDocDetail /> },
            { path: "/ftr_docs/view/:id", element: <FtrDocDetail /> },
            { path: "/ftr_record_docs", element: <FtrRecordDocs /> },
            { path: "/train_record_docs", element: <TrainRecordDocs /> },
            { path: "/train_record_docs/edit/:id", element: <TrainRecordDocDetail /> },
            { path: "/train_record_docs/view/:id", element: <TrainRecordDocDetail /> },
            { path: "/ftr_record_docs/edit/:id", element: <FtrRecordDocDetail /> },
            { path: "/ftr_record_docs/view/:id", element: <FtrRecordDocDetail /> },
            { path: "/utp_docs", element: <UtpDocs /> },
            { path: "/utp_docs/edit/:id", element: <UtpDocDetail /> },
            { path: "/utp_docs/view/:id", element: <UtpDocDetail /> },
            { path: "/utr_docs", element: <UtrDocs /> },
            { path: "/utr_docs/edit/:id", element: <UtrDocDetail /> },
            { path: "/utr_docs/view/:id", element: <UtrDocDetail /> },
            { path: "/str_docs", element: <StrDocs /> },
            { path: "/str_docs/edit/:id", element: <StrDocDetail /> },
            { path: "/str_docs/view/:id", element: <StrDocDetail /> },
            { path: "/bug_docs", element: <BugDocs /> },
            { path: "/pir_docs", element: <PirDocs /> },
            { path: "/pir_docs/edit/:id", element: <PirDocDetail /> },
            { path: "/pir_docs/view/:id", element: <PirDocDetail /> },
            { path: "/vuh_docs", element: <VuhDocs /> },
            { path: "/vuh_docs/edit/:id", element: <VuhDocDetail /> },
            { path: "/vuh_docs/view/:id", element: <VuhDocDetail /> },
            { path: "/ptr_docs", element: <PtrDocs /> },
            { path: "/ptr_docs/edit/:id", element: <PtrDocDetail /> },
            { path: "/ptr_docs/view/:id", element: <PtrDocDetail /> },
            { path: "/label_docs", element: <LabelDocs /> },
            { path: "/label_docs/edit/:id", element: <LabelDocDetail /> },
            { path: "/label_docs/view/:id", element: <LabelDocDetail /> },
            { path: "/release_notes", element: <ReleaseNotes /> },
            { path: "/release_notes/edit/:id", element: <ReleaseNoteDetail /> },
            { path: "/release_notes/view/:id", element: <ReleaseNoteDetail /> },
            { path: "/pha_docs", element: <PhaDocs /> },
            { path: "/pha_docs/edit/:id", element: <PhaDocDetail /> },
            { path: "/pha_docs/view/:id", element: <PhaDocDetail /> },
            { path: "/cyber_cap_docs", element: <CyberCapDocs /> },
            { path: "/cyber_cap_docs/edit/:id", element: <CyberCapDocDetail /> },
            { path: "/cyber_cap_docs/view/:id", element: <CyberCapDocDetail /> },
            { path: "/research_docs", element: <ResearchDocs /> },
            { path: "/research_docs/edit/:id", element: <ResearchDocDetail /> },
            { path: "/research_docs/view/:id", element: <ResearchDocDetail /> },
            { path: "/nsr_docs", element: <NsrDocs /> },
            { path: "/nsr_docs/edit/:id", element: <NsrDocDetail /> },
            { path: "/nsr_docs/view/:id", element: <NsrDocDetail /> },
            { path: "/acc_docs", element: <AccDocs /> },
            { path: "/acc_docs/edit/:id", element: <AccDocDetail /> },
            { path: "/acc_docs/view/:id", element: <AccDocDetail /> },
            { path: "/nsmp_docs", element: <NsmpDocs /> },
            { path: "/nsmp_docs/edit/:id", element: <NsmpDocDetail /> },
            { path: "/nsmp_docs/view/:id", element: <NsmpDocDetail /> },
            { path: "/rmp_docs", element: <RmpDocs /> },
            { path: "/rmp_docs/edit/:id", element: <RmpDocDetail /> },
            { path: "/rmp_docs/view/:id", element: <RmpDocDetail /> },

            {path: "/prod_traces", element: <ProdTraces /> },
            {path: "/prod_comparison", element: <ProdComparison /> },
            {path: "/doc_integrate_export", element: <DocIntegrateExport /> },
            {path: "/doc_export_records", element: <DocExportRecords /> },
            {path: "/doc_one_click_print", element: <DocOneClickPrint /> },
            {path: "/doc_print_records", element: <DocPrintRecords /> },
        ],
    },
]);

const App = () => {
    const [data, dispatch] = useData({ antLocale: ANT_LOCALES[DEF_LANG] });
    const { i18n, t: ts } = useTranslation();

    useEffect(() => {
        dispatch({ antLocale: ANT_LOCALES[i18n.language] });
        document.title = ts("html_title");
    }, [i18n.language]);

    useEffect(() => {
        let rafId = 0;
        const setTableCellTitle = () => {
            const cells = document.querySelectorAll<HTMLElement>(".ant-table-tbody td.ant-table-cell");
            cells.forEach((cell) => {
                // 交互控件单元格不加 title，避免遮挡点击
                if (cell.querySelector("input, textarea, button, .ant-btn, .ant-select, .ant-picker, .ant-switch, .ant-checkbox")) {
                    cell.removeAttribute("title");
                    return;
                }
                const text = (cell.textContent || "").replace(/\s+/g, " ").trim();
                if (text) {
                    cell.setAttribute("title", text);
                } else {
                    cell.removeAttribute("title");
                }
            });
        };

        const schedule = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(setTableCellTitle);
        };

        schedule();
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, []);

    return (
        <Provider store={store}>
            <ConfigProvider locale={data.antLocale}>
                <RouterProvider router={router} />
            </ConfigProvider>
        </Provider>
    );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
