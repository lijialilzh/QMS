import logging
import re
from typing import Dict, List
from ...obj.node import Node


logger = logging.getLogger(__name__)

def fix_chapter(p_title: str, nodes: List[Node]):
    chapter =re.search(r'(\d(\.\d)*)', p_title or "")
    chapter = chapter.group() if chapter else None
    chapter = f"{chapter}." if chapter else ""
    for idx, node in enumerate(nodes or []):
        if node.with_chapter == 1 and chapter and node.title:
            node.title = f"{chapter}{idx+1} {node.title}"
            fix_chapter(node.title, node.children)

def find_parent(Cls, levels: List[str], parents: Dict[str, Node]):
    levels = [level for level in levels if level]
    c_obj = None
    c_idx = -1
    logger.info("A: %s", levels)
    for index, _ in enumerate(levels):
        rindex = len(levels) - index
        c_levels = levels[:rindex]
        c_key = ".".join(c_levels)
        logger.info("B: %s", c_key)
        c_obj = parents.get(c_key)
        if c_obj:
            c_idx = rindex
            break

    c_idx = c_idx if c_idx >= 0 else 0
    for idx in range(c_idx, len(levels)):
        c_levels = levels[:idx+1]
        c_key = ".".join(c_levels)
        logger.info("C: %s", c_key)
        title = c_levels[-1]
        with_chapter = 1 if title else 0
        c_obj = parents.get(c_key) or Cls(with_chapter=with_chapter, children=[], title=title, level=idx, priority=len(parents))
        parents[c_key] = c_obj
        if idx > 0:
            p_leves = levels[:idx]
            p_key = ".".join(p_leves)
            p_obj = parents.get(p_key)
            if not p_obj:
                logger.warning("D: %s", c_key)
                continue
            p_obj.children.append(c_obj)
    return c_obj

def iter_tree(tree: List[Node]):
    for node in tree:
        yield node
        if node.children:
            yield from iter_tree(node.children)
