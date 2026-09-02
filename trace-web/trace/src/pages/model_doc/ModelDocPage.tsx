import { useParams } from "react-router-dom";
import ModelDocDetail from "./ModelDocDetail";
import ModelEqDocDetail from "./ModelEqDocDetail";
import ModelEnvDocDetail from "./ModelEnvDocDetail";
import ModelCrrDocDetail from "./ModelCrrDocDetail";
import ModelBuildDocDetail from "./ModelBuildDocDetail";
import ModelTrainDocDetail from "./ModelTrainDocDetail";
import ModelTestDocDetail from "./ModelTestDocDetail";
import ModelPkgDocDetail from "./ModelPkgDocDetail";

const EQ_DOC_TYPES = new Set(["md_deq", "md_teq", "md_eq"]);
const ENV_DOC_TYPES = new Set(["md_019", "md_020"]);
const CRR_DOC_TYPES = new Set(["md_008_01", "md_008_02"]);
const BUILD_DOC_TYPES = new Set(["md_009_01", "md_009_02", "md_010_01", "md_010_02", "md_011_01", "md_011_02"]);
const TRAIN_DOC_TYPES = new Set(["md_012_01", "md_012_02"]);
const TEST_DOC_TYPES = new Set(["md_013_01", "md_013_02"]);
const PKG_DOC_TYPES = new Set(["md_015_01", "md_015_02", "md_016", "md_018"]);

export default () => {
    const { type } = useParams();
    if (EQ_DOC_TYPES.has(type || "")) return <ModelEqDocDetail />;
    if (ENV_DOC_TYPES.has(type || "")) return <ModelEnvDocDetail />;
    if (CRR_DOC_TYPES.has(type || "")) return <ModelCrrDocDetail />;
    if (BUILD_DOC_TYPES.has(type || "")) return <ModelBuildDocDetail />;
    if (TRAIN_DOC_TYPES.has(type || "")) return <ModelTrainDocDetail />;
    if (TEST_DOC_TYPES.has(type || "")) return <ModelTestDocDetail />;
    if (PKG_DOC_TYPES.has(type || "")) return <ModelPkgDocDetail />;
    return <ModelDocDetail />;
};
