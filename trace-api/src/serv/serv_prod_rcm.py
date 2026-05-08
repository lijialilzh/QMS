import logging
import json
import os
import re
from typing import List
from sqlalchemy import select, delete, func
from sqlalchemy.sql import desc
from sqlalchemy.dialects.postgresql import insert as pg_insert
from openpyxl import load_workbook
from openpyxl.styles import Alignment
from ..obj.vobj_user import UserObj
from ..model.test_set import TestSet
from ..model.srs_doc import SrsDoc, SrsNode
from ..model.srs_req import ReqRcm
from ..model.product import Product, UserProd
from ..model.test_case import TestCase
from ..model.rcm import Rcm
from ..model.srs_req import SrsReq
from ..model.prod_rcm import ProdRcm
from ..obj.tobj_prod_rcm import ProdRcmsForm
from ..obj.vobj_prod_rcm import ProdRcmObj
from ..utils.sql_ctx import db
from ..utils.i18n import ts
from ..obj import Page, Resp
from . import msg_err_db

logger = logging.getLogger(__name__)


class Server(object):

    def __normalize_code(self, value: str) -> str:
        text = re.sub(r"\s+", "", str(value or "")).replace("＿", "_").upper()
        return re.sub(r"[，。；;、,.]+$", "", text)

    def __split_srs_codes(self, value: str) -> List[str]:
        text = str(value or "")
        matches = re.findall(r"SRS[\s\-_]*[A-Z0-9.]+(?:\s*-\s*[A-Z0-9.]+)*", text, flags=re.I)
        if matches:
            codes = [self.__normalize_code(match.strip(" ,，;；、\n\r\t")) for match in matches]
        else:
            codes = [self.__normalize_code(item) for item in re.split(r"[,，;；、\s]+", text)]
        return [code for code in dict.fromkeys(codes) if code]

    def __split_rcm_codes(self, value: str) -> List[str]:
        text = str(value or "")
        matches = re.findall(r"\bRCM[\s\-_]*[A-Z0-9]+(?:[\-_][A-Z0-9]+)*\b", text, flags=re.I)
        codes = [self.__normalize_code(match.strip(" ,，;；、\n\r\t")) for match in matches]
        return [code for code in dict.fromkeys(codes) if code]

    def __build_trace_rule_from_srs_code(self, srs_code: str):
        code = str(srs_code or "").strip().upper()
        matched = re.match(r"^SRS-([A-Z]+)(\d+)-(\d+)$", code)
        if not matched:
            return None
        major = matched.group(2)
        minor = matched.group(3)
        if len(major) < 2:
            return None
        return {
            "if_code": major[-2:],
            "unit_group": minor.zfill(3),
        }

    def __normalize_test_stage(self, stage: str) -> str:
        text = str(stage or "").strip()
        if "系统" in text:
            return "系统测试"
        if "集成" in text:
            return "集成测试"
        if "单元" in text:
            return "单元测试"
        if "用户" in text:
            return "用户测试"
        return text

    def __rcm_match_terms(self, description: str) -> List[str]:
        text = re.sub(r"\bRCM[\s\-_]*[A-Z0-9]+(?:[\-_][A-Z0-9]+)*[.。]?", "", str(description or ""), flags=re.I)
        text = re.sub(r"[，。；;、,.：:（）()【】\[\]\s]+", " ", text)
        for word in ["本产品", "产品", "软件", "系统", "用户", "医生", "校验", "验证", "支持", "进行", "再次", "确认"]:
            text = text.replace(word, " ")
        parts = [item.strip() for item in re.split(r"\s+|时|会有|如果|不同|请|与", text) if item and len(item.strip()) >= 2]
        terms = []
        for part in parts:
            if len(part) >= 4:
                terms.append(part)
            if len(part) > 6:
                for size in [6, 5, 4]:
                    for idx in range(0, len(part) - size + 1):
                        terms.append(part[idx:idx + size])
        return list(dict.fromkeys([term for term in terms if len(term) >= 4]))

    def __filter_tests_by_rcm_description(self, tests: List[TestCase], rcm: Rcm = None, require_match: bool = False) -> List[TestCase]:
        if not tests or not rcm:
            return tests
        terms = self.__rcm_match_terms(getattr(rcm, "description", "") or "")
        if not terms:
            return [] if require_match else tests
        scored = []
        for test in tests:
            merged_text = "\n".join([
                str(getattr(test, "function", "") or ""),
                str(getattr(test, "description", "") or ""),
                str(getattr(test, "test_step", "") or ""),
                str(getattr(test, "expect", "") or ""),
                str(getattr(test, "note", "") or ""),
            ])
            score = sum(1 for term in terms if term in merged_text)
            if score > 0:
                scored.append((score, test))
        if not scored:
            return [] if require_match else tests
        max_score = max(score for score, _ in scored)
        return [test for score, test in scored if score == max_score]

    async def add_prod_rcms(self, form: ProdRcmsForm):
        try:
            values = []
            for rcm_id in form.rcm_ids:
                values.append(dict(prod_id=form.prod_id, rcm_id=rcm_id))
            db.session.execute(pg_insert(ProdRcm).values(values).on_conflict_do_nothing())
            db.session.commit()
            return Resp.resp_ok()
        except Exception:
            logger.exception("")
            db.session.rollback()
        return Resp.resp_err(msg=ts(msg_err_db))
   
    async def delete_prod_rcms(self, ids: List[str]):
        if ids:
            db.session.execute(delete(ProdRcm).where(ProdRcm.id.in_(ids)))
            db.session.commit()
        return Resp.resp_ok()

    def __repair_req_rcms_from_srs_nodes(self, product_ids: List[int]):
        product_ids = [product_id for product_id in dict.fromkeys(product_ids or []) if product_id]
        if not product_ids:
            return
        rows = db.session.execute(
            select(SrsNode, SrsDoc)
            .join(SrsDoc, SrsNode.doc_id == SrsDoc.id)
            .where(SrsDoc.product_id.in_(product_ids))
        ).all()
        if not rows:
            return

        doc_ids = [doc.id for _node, doc in rows]
        all_nodes = db.session.execute(select(SrsNode).where(SrsNode.doc_id.in_(doc_ids))).scalars().all()
        node_by_doc = {}
        for node in all_nodes:
            node_by_doc.setdefault(node.doc_id, {})[node.n_id] = node

        def normalize_match_text(value: str):
            txt = re.sub(r"^\s*\d+(?:\.\d+)*[\s、.．:：\-]*", "", str(value or "")).strip()
            return re.sub(r"[\s\u3000、，。；;：:（）()【】\[\]_\-]+", "", txt).upper()

        req_rows_all = db.session.execute(select(SrsReq).where(SrsReq.doc_id.in_(doc_ids))).scalars().all()
        req_name_index = {}
        for req in req_rows_all:
            for name in [req.sub_function or "", req.function or "", req.module or ""]:
                key = normalize_match_text(name)
                if not key:
                    continue
                codes = req_name_index.setdefault((req.doc_id, key), [])
                if req.code not in codes:
                    codes.append(req.code)

        def resolve_srs_by_function_context(node):
            cur = node
            safety = 0
            titles = []
            while cur and safety < 50:
                if cur.title:
                    titles.append(cur.title)
                cur = node_by_doc.get(node.doc_id, {}).get(cur.p_id)
                safety += 1
            for title in titles:
                key = normalize_match_text(title)
                codes = req_name_index.get((node.doc_id, key)) or []
                if len(codes) == 1:
                    return self.__normalize_code(codes[0])
            return ""

        def node_search_text(node):
            parts = [node.title or "", node.label or "", node.text or ""]
            if node.table:
                parts.append(table_search_text(node.table))
            return "\n".join(parts)

        def table_search_text(table):
            payload = table
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except Exception:
                    return payload
            if not isinstance(payload, dict):
                return str(payload or "")
            values = []
            for header in payload.get("headers") or []:
                values.append(str((header or {}).get("name") or ""))
            for row in payload.get("rows") or []:
                for value in (row or {}).values():
                    values.append(str(value or ""))
            for row in payload.get("cells") or []:
                for cell in row or []:
                    values.append(str((cell or {}).get("value") or ""))
            return "\n".join(values)

        def extract_srs_codes_from_node(node):
            result = []
            for hit in re.findall(r"SRS[\s\-_]*[A-Z0-9.]+(?:\s*-\s*[A-Z0-9.]+)*", node_search_text(node), flags=re.I):
                code = self.__normalize_code(hit)
                if code and code not in result:
                    result.append(code)
            return result

        pairs = []
        all_srs_codes = set()
        all_rcm_codes = set()
        for node, _doc in rows:
            direct_srs_codes = extract_srs_codes_from_node(node)
            srs_code = self.__normalize_code(node.srs_code)
            parent_id = node.p_id
            if not direct_srs_codes:
                while not srs_code and parent_id:
                    parent = node_by_doc.get(node.doc_id, {}).get(parent_id)
                    if not parent:
                        break
                    srs_code = self.__normalize_code(parent.srs_code)
                    parent_id = parent.p_id
            if not srs_code:
                direct_srs_codes = direct_srs_codes or []
            else:
                direct_srs_codes = direct_srs_codes or [srs_code]
            rcm_codes = self.__split_rcm_codes(node.rcm_codes) or self.__split_rcm_codes(node_search_text(node))
            if not rcm_codes:
                continue
            if not direct_srs_codes:
                context_srs_code = resolve_srs_by_function_context(node)
                direct_srs_codes = [context_srs_code] if context_srs_code else []
            for code in direct_srs_codes:
                if not code:
                    continue
                all_srs_codes.add(code)
                all_rcm_codes.update(rcm_codes)
                pairs.append((node.doc_id, code, rcm_codes))
        if not pairs:
            return

        req_rows = db.session.execute(select(SrsReq).where(SrsReq.code.in_(all_srs_codes))).scalars().all()
        req_id_by_doc_code = {(row.doc_id, self.__normalize_code(row.code)): row.id for row in req_rows}
        rcm_rows = db.session.execute(select(Rcm)).scalars().all()
        rcm_id_by_code = {self.__normalize_code(row.code): row.id for row in rcm_rows}
        affected_rcm_ids = [rcm_id_by_code[code] for code in all_rcm_codes if code in rcm_id_by_code]

        insert_values = []
        seen_pairs = set()
        for doc_id, srs_code, rcm_codes in pairs:
            req_id = req_id_by_doc_code.get((doc_id, srs_code))
            if not req_id:
                continue
            for rcm_code in rcm_codes:
                rcm_id = rcm_id_by_code.get(rcm_code)
                if not rcm_id:
                    continue
                key = (req_id, rcm_id)
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                insert_values.append(dict(req_id=req_id, rcm_id=rcm_id))
        if affected_rcm_ids:
            affected_req_ids = db.session.execute(
                select(SrsReq.id).where(SrsReq.doc_id.in_(doc_ids))
            ).scalars().all()
            if affected_req_ids:
                db.session.execute(
                    delete(ReqRcm).where(
                        ReqRcm.req_id.in_(affected_req_ids),
                        ReqRcm.rcm_id.in_(affected_rcm_ids),
                    )
                )
        if insert_values:
            db.session.execute(pg_insert(ReqRcm).values(insert_values).on_conflict_do_nothing())
        if affected_rcm_ids or insert_values:
            db.session.commit()
    
    def __query_srs_reqs(self, rcm_ids: List[int]) -> List[str]:
        rcm_ids = [rcm_id for rcm_id in (rcm_ids or []) if rcm_id]
        if not rcm_ids:
            return [], {}
        sql = select(ReqRcm, SrsReq, SrsDoc).join(SrsReq, ReqRcm.req_id == SrsReq.id)
        sql = sql.join(SrsDoc, SrsReq.doc_id == SrsDoc.id)
        sql = sql.where(ReqRcm.rcm_id.in_(rcm_ids)).order_by(SrsReq.code)
        results = dict()
        srs_codes = []        
        for req_rcm, row_srs, row_doc in db.session.execute(sql):
            key = (row_doc.product_id, req_rcm.rcm_id)
            reqs = results.get(key) or []
            reqs.append(row_srs)
            results[key] = reqs
            srs_codes.append(self.__normalize_code(row_srs.code))

        return srs_codes, results
    
    def __query_tests(self, product_ids: List[int], srs_codes: List[str]) -> dict:
        product_ids = [product_id for product_id in dict.fromkeys(product_ids or []) if product_id]
        wanted_srs_codes = {self.__normalize_code(code) for code in (srs_codes or []) if self.__normalize_code(code)}
        if not product_ids or not wanted_srs_codes:
            return {}
        sql = select(TestCase, TestSet).join(TestSet, TestCase.set_id == TestSet.id)
        sql = sql.where(TestSet.product_id.in_(product_ids)).order_by(TestCase.set_id, TestCase.code)
        rows: list[TestCase, TestSet] = db.session.execute(sql).all()
        results = dict()
        for row_test, row_set in rows:
            setattr(row_test, "_prod_rcm_stage", self.__normalize_test_stage(row_set.stage))
            for srs_code in self.__split_srs_codes(row_test.srs_code):
                if srs_code in wanted_srs_codes:
                    results.setdefault((row_set.product_id, srs_code), []).append(row_test)
        for product_id in product_ids:
            for srs_code in wanted_srs_codes:
                if results.get((product_id, srs_code)):
                    continue
                trace_rule = self.__build_trace_rule_from_srs_code(srs_code)
                if not trace_rule:
                    continue
                sys_prefix = f"TS{trace_rule['if_code']}-{trace_rule['unit_group']}-"
                matched_tests = [
                    row_test
                    for row_test, row_set in rows
                    if row_set.product_id == product_id and self.__normalize_code(row_test.code).startswith(sys_prefix)
                ]
                if matched_tests:
                    results[(product_id, srs_code)] = matched_tests
        return results
    
    def __merge_tests(self, product_id, srs_codes: List[str], tests_dict: dict, rcm: Rcm = None) -> List[str]:
        test_sets = dict()
        uniq_sets = dict()
        for srs_code in srs_codes:
            tests = tests_dict.get((product_id, self.__normalize_code(srs_code))) or []
            if rcm:
                matched_tests = []
                fallback_stage_tests = []
                for stage in ["系统测试", "集成测试", "单元测试", "用户测试"]:
                    stage_tests = [test for test in tests if getattr(test, "_prod_rcm_stage", "") == stage]
                    if stage_tests and not fallback_stage_tests:
                        fallback_stage_tests = stage_tests
                    if stage == "用户测试":
                        # 用户测试按该 SRS 的测试范围展示，不再按 RCM 文本收窄到单条。
                        continue
                    matched_tests = self.__filter_tests_by_rcm_description(stage_tests, rcm, require_match=True)
                    if matched_tests:
                        break
                tests = matched_tests or fallback_stage_tests or self.__filter_tests_by_rcm_description(tests, rcm)
            for test in tests:
                key = (srs_code, test.set_id)
                uniq_set = uniq_sets.setdefault(key, set())
                if test.code not in uniq_set:
                    uniq_set.add(test.code)
                    test_sets.setdefault(key, []).append(test.code)
        results = []
        for key, tests in test_sets.items():
            if len(tests) > 1:
                result = "~".join([tests[0], tests[-1]])
                results.append(result)
            elif len(tests) == 1:
                results.append(tests[0])
        return results

    async def list_prod_rcm(self, op_user: UserObj, export = False, prod_id: int = None, page_index: int = 0, page_size: int = 10):
        page_index = page_index if page_index >= 0 else 0
        page_size = page_size if page_size > 0 else 10 

        sql = select(ProdRcm, Product, Rcm).join(Product, ProdRcm.prod_id == Product.id).outerjoin(Rcm, ProdRcm.rcm_id == Rcm.id)
        if prod_id:
            sql = sql.where(ProdRcm.prod_id == prod_id)
        if not prod_id and op_user and op_user.id != 1:
            subquery = select(UserProd.product_id).where(UserProd.user_id == op_user.id).scalar_subquery()
            sql = sql.where(Product.id.in_(subquery))
        total = 0
        if not export:
            sql_count = select(func.count()).select_from(sql)
            total = db.session.execute(sql_count).scalars().first()
        sql = sql.order_by(Rcm.code)
        rows: list[ProdRcm, Product, Rcm] = db.session.execute(sql).all()
        objs = []
        self.__repair_req_rcms_from_srs_nodes([row_prd.id for _, row_prd, _ in rows])
        all_srs_codes, reqs_dict = self.__query_srs_reqs([prod_rcm.rcm_id for prod_rcm, _, _ in rows])
        tests_dict = self.__query_tests([row_prd.id for _, row_prd, _ in rows], all_srs_codes)
        for row, row_prd, row_rcm in rows:
            obj = ProdRcmObj(**row_rcm.dict()) if row_rcm else ProdRcmObj()
            obj.id = row.id
            obj.rcm_id = row.rcm_id
            obj.create_time = row.create_time
            reqs = reqs_dict.get((row_prd.id, row.rcm_id)) or []
            obj.srs_codes = list(dict.fromkeys([self.__normalize_code(req.code) for req in reqs if self.__normalize_code(req.code)]))
            obj.srs_flag = True if obj.srs_codes else False
            obj.test_codes = self.__merge_tests(row_prd.id, obj.srs_codes, tests_dict, row_rcm)
            
            obj.product_name = row_prd.name
            obj.product_version = row_prd.full_version
            objs.append(obj)
        return Resp.resp_ok(data=Page(total=total, page_size=page_size, rows=objs, page_index=page_index))

    export_columns = [
        "code",
        "description",
        "srs_flag",
        "srs_codes",
        "test_codes",
        "proof",
        "note",
    ]

    async def export_prod_rcms(self, op_user: UserObj, output, *args, **kwargs):
        resp = await self.list_prod_rcm(op_user, *args, **kwargs)
        rows = resp.data.rows or []

        temp_path = os.path.join(os.path.dirname(__file__), "temp_prod_rcm.xlsx")
        wb = load_workbook(temp_path)
        ws = wb[wb.sheetnames[0]]
        for ridx, row in enumerate(rows, 2):
            obj = row.dict()
            for cidx, key in enumerate(self.export_columns, 1):
                value = obj.get(key)
                if key == "srs_codes" or key == "test_codes":
                    value = "，\n".join(value)
                if key == "srs_flag":
                    value = ts("yes") if value else ts("no")
                ws.cell(row=ridx, column=cidx, value=value)

        align = Alignment(vertical='center', wrap_text=True)
        for row in ws.iter_rows():
            for cell in row:
                cell.alignment = align
        wb.save(output)
        output.seek(0)
        