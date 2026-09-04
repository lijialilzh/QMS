import { useParams } from "react-router-dom";
import DataDocDetail from "./DataDocDetail";
import DataEnvDocDetail from "./DataEnvDocDetail";
import DataRecordDocDetail from "./DataRecordDocDetail";
import { DATA_RECORD_DOC_TYPES } from "./DataDocTypes";

const ENV_DOC_TYPES = new Set(["dd_016", "dd_017"]);

export default () => {
    const { type } = useParams();
    if (ENV_DOC_TYPES.has(type || "")) return <DataEnvDocDetail />;
    if (DATA_RECORD_DOC_TYPES.has(type || "")) return <DataRecordDocDetail />;
    return <DataDocDetail />;
};
