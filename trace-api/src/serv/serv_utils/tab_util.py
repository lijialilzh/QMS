from typing import List

def find_node(nodes: List, c_path: List[int],  t_path: List[int]):
    for idx, node in enumerate(nodes or []):
        n_path = c_path + [idx]
        if n_path == t_path:
            return node
        if node.children:
            result = find_node(node.children, n_path, t_path)
            if result:
                return result
            