from typing import List


def find_parent(levels: List[str], parents: dict):
    p_obj = None
    p_idx = -1
    print("A: ", levels)
    for index, _ in enumerate(levels):
        rindex = len(levels) - index
        p_key = ".".join(levels[:rindex])
        print("B: ", p_key)
        p_obj = parents.get(p_key)
        if p_obj:
            p_idx = rindex
            break

    p_idx = p_idx if p_idx >= 0 else 0
    for idx in range(p_idx, len(levels)):
        p_key = ".".join(levels[:idx+1])
        print("C: ", p_key)
        p_obj = {"childs": [], "text": p_key}
        parents[p_key] = p_obj
    return p_obj


def iter_nodes(nodes: List[dict]):
    for node in nodes:
        print("D: ", node["text"])
        childs = node.get("childs", [])
        iter_nodes(childs)


if __name__ == "__main__":
    rows = [
        {
            "level": ["a1", "b1"],
            "text": "a1.b1.1"
        },
        {
            "level": ["a1", "b1"],
            "text": "a1.b1.2"
        },
        {
            "level": ["a1", "c1"],
            "text": "a1.c1.1"
        },
        {
            "level": ["a1", "c1"],
            "text": "a1.c1.2"
        },
        {
            "level": ["a1", "c2"],
            "text": "a1.c2.1"
        },
         {
            "level": ["a2", "c2"],
            "text": "a2.c2.1"
        },
    ]
    parents = dict()
    for row in rows:
        levels = row["level"]
        p_obj = find_parent(levels, parents)
        p_obj["childs"].append(row)
    
    root_nodes = [node for key, node in parents.items()]
    for root in root_nodes:
        print("E: ", root["text"])
    iter_nodes(root_nodes)