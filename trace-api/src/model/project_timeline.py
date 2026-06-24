#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


from sqlalchemy import Column, Integer, String, TEXT, UniqueConstraint
from . import Model


class ProjectTimelineRow(Model):
    """项目时间逻辑线 - 行（日期行 / 年份行 / 阶段里程碑行）。"""
    __tablename__ = "project_timeline_row"
    prod_id = Column(Integer, nullable=False, index=True, comment="产品ID")
    year = Column(String(16), comment="年")
    month = Column(String(16), comment="月")
    day = Column(String(16), comment="日")
    # date=普通日期行；year=年份分组行；milestone=阶段里程碑行
    row_type = Column(String(16), default="date", comment="行类型 date/year/milestone")
    milestone_text = Column(String(256), comment="里程碑/年份说明文本")
    sort_order = Column(Integer, default=0, comment="排序")


class ProjectTimelineCell(Model):
    """项目时间逻辑线 - 单元格（某行某部门的输出结果）。"""
    __tablename__ = "project_timeline_cell"
    __table_args__ = (UniqueConstraint("row_id", "dept", name="project_timeline_cell_row_dept_key"),)
    row_id = Column(Integer, nullable=False, index=True, comment="所属行ID")
    dept = Column(String(64), nullable=False, comment="部门")
    output_result = Column(TEXT, comment="输出结果")
