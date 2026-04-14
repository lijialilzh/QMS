const tryFetch = async (path: any) => {
    try {
        return (await fetch(path)).json();
    } catch (ex) {
        console.error(ex);
    }
};

export default (await tryFetch("env.json")) || {};
