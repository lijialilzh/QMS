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
import Hazs from "./pages/basedata/Hazs";
import Rcms from "./pages/basedata/Rcms";
import Csts from "./pages/basedata/Csts";
import Products from "./pages/product/Products";
import SrsDocs from "./pages/srs_doc/SrsDocs";
import SdsDocs from "./pages/sds_doc/SdsDocs";
import SrsDocDetail from "./pages/srs_doc/SrsDocDetail";
import SdsDocDetail from "./pages/sds_doc/SdsDocDetail";
import SdsReqds from "./pages/sds_doc/SdsReqds";
import SrsManage from "./pages/srs_doc/SrsManage";
import SrsReq from "./pages/srs_doc/SrsReq";
import TestSets from "./pages/test_set/TestSets";
import DocFiles from "./pages/doc_file/DocFiles";
import ProdHazs from "./pages/prod_risk/prod_haz";
import ProdRcms from "./pages/prod_risk/prod_rcm";
import ProdCsts from "./pages/prod_risk/prod_cst";
import ProdDhfs from "./pages/prod_risk/ProdDhfs";
import SdsTraces from "./pages/sds_doc/SdsTraces";
import SrsDocTrace from "./pages/prod_risk/SrsDocTrace";
import ProdTraces from "./pages/overview/ProdTraces";
import ProdComparison from "./pages/overview/ProdComparison";

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

            { path: "/hazs", element: <Hazs /> },
            { path: "/rcms", element: <Rcms /> },
            { path: "/csts", element: <Csts /> },

            { path: "/products", element: <Products /> },
            { path: "/prod_dhfs", element: <ProdDhfs /> },
            
            { path: "/srs_docs", element: <SrsDocs /> },
            { path: "/srs_docs/add", element: <SrsDocDetail /> },
            { path: "/srs_docs/edit/:id", element: <SrsDocDetail /> },
            { path: "/srs_docs/view/:id", element: <SrsDocDetail /> },
            { path: "/srs_manage", element: <SrsManage /> },
            { path: "/srs_req", element: <SrsReq /> },

            { path: "/sds_docs", element: <SdsDocs /> },
            { path: "/sds_docs/add", element: <SdsDocDetail /> },
            { path: "/sds_docs/edit/:id", element: <SdsDocDetail /> },
            { path: "/sds_docs/view/:id", element: <SdsDocDetail /> },
            { path: "/sds_reqds", element: <SdsReqds /> },
            { path: "/sds_traces", element: <SdsTraces /> },

            { path: "/test_sets", element: <TestSets /> },

            { path: "/doc_files_topo", element: <DocFiles fileType="img_topo" /> },
            { path: "/doc_files_flow", element: <DocFiles fileType="img_flow" /> },
            { path: "/doc_files_struct", element: <DocFiles fileType="img_struct" /> },

            { path: "/prod_hazs", element: <ProdHazs /> },
            { path: "/prod_rcms", element: <ProdRcms /> },
            { path: "/prod_csts", element: <ProdCsts /> },
            { path: "/srs_doc_trace", element: <SrsDocTrace /> },

            {path: "/prod_traces", element: <ProdTraces /> },
            {path: "/prod_comparison", element: <ProdComparison /> },
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
